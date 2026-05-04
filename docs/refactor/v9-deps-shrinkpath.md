# V9 Deps Shrinkpath — host-binding consolidation blueprint

> Working draft — assembled 2026-05-04 across ralph-loop iterations
> 1–3. **This document is the V9 launch blueprint, not the V9 work
> itself.** The point is to make the next ralph-loop session able to
> start executing without re-doing the inventory.
>
> Status: All 5 sections inventoried. Multiple incorrect hypotheses
> from earlier iterations have been corrected:
> - §3 was "AppState/AppStateCompat double type" — actually a 3-file
>   re-export chain. Real TS2322 root cause is TaskState double union.
> - §4+§5 was "4 dead `= unknown` placeholders to remove" — actually
>   95 V7 §7.2 boundary shims that are deliberate architectural
>   pattern, requiring `import type` rewrite (not deletion).

## Why V9

V8 / post-V8 closed every cheap shrink: `_DEPRECATED` → 0,
lazy-requires 11 → 1, dead files / dead exports collapsed, ratchets
locked at the current floor (tsc=3179, knip-files=9, knip-exports=33,
silent-failure=737/0/0, as-never=42).

What remains cannot be shrunk by removing files. It needs **type
narrowing through `import type`** — replacing the V7 §7.2 host-binding
type-side `unknown` placeholders with real types pulled compile-time-only
from canonical homes. The runtime architecture (setter-injected bindings)
stays unchanged.

## TL;DR — V9 phase order

| Phase | Section | Scope | Risk | Status |
|-------|---------|-------|------|--------|
| V9-1 | §1 | Delete dead defensive `require()` fallback in `_deps.ts` (was over-engineered to "host binding" plan; reality was simpler) | Low | **✅ landed 2026-05-04** — `lazyRequires` 1 → 0 |
| V9-2 | §2 | Delete 6 dead unknown setter slots in `_deps.ts` (revised plan: turned out to be dead code, not import-type rewrite candidates) | Low | **✅ landed 2026-05-04** — `unknownSlots` 6 → 0 |
| V9-2.5 | §2 | Delete 3 additional dead LSP/MCP getter pairs (`_getLspManager`, `_getMcpTypes`, `_expandMcpEnv` — verify-deps-quality blind spot since their slot type is `() => unknown` not bare `unknown`) | Low | **✅ landed 2026-05-04** — 3 more dead pairs gone, 75 LOC + 1 require to non-existent `src/` path |
| V9-2.6 | §2 | Fix broken `isDuplicatePath` stub (was `(a, b) => a === b`, callers passed 3 args — plugin-loader path-dedup silently never fired). Replace with real symlink-resolving impl. | Medium (real bug fix) | **✅ landed 2026-05-04** — caller arity fixed in 6 sites, regression test added |
| V9-2.7 | §2 | Delete 4 dead exports (`safeParseJSON`, `BUILTIN_PLUGIN_IDS`, `checkBinaryExists` chain) + dead `storage/fsOperations.ts:isDuplicatePath` (post-V9-2.6 stale). Caller `lspRecommendation.ts` switched to direct `@claude-code/updater/binaryCheck.js` import. **Discovered second broken-stub bug**: `coerceDescriptionToString` 1-arg local stub returned `''` instead of `null`, breaking the `??` fallback chain in 5 plugin-loader callsites. Fixed by re-exporting the real 3-arg impl from `frontmatterParser.ts`. | Medium (1 real bug + dead code) | **✅ landed 2026-05-04** — 7-case regression test added, ~80 LOC removed |
| V9-2.8 | §2 | Shadow-stub scan found a P0 bug: **`BUILTIN_MARKETPLACE_NAME = 'anthropics'`** in `_deps.ts` shadowed the real `'builtin'` in `builtin.ts`. `pluginLoader.ts:1913` used the bad copy to filter built-in plugins; the filter never matched (real plugin ids are `name@builtin`, not `name@anthropics`), so built-in plugins fell through into the marketplace-loading branch. Plus `FRONTMATTER_REGEX` had a stricter copy than the real impl. Fix: replace 6 hand-typed constants in `_deps.ts` with `export { X } from <canonical>` re-exports — single source of truth. | High (P0 bug — production logic silently wrong for built-in plugins) | **✅ landed 2026-05-04** — 3-case regression test added; 6 shadow constants collapsed |
| V9-3 | §3 | Replace `swarm/adapters/appRuntime.ts:57` 3-field minimum-subset `TaskStateBase` shim with `export type { TaskStateBase } from '@claude-code/tool-registry/Task.js'`. The runtime always returned the full 11-field shape via `createTaskStateBase`; the type-side shim was a V7 §7.2 holdover hiding it from swarm TS. | Low (single type re-export; runtime unaffected) | **✅ landed 2026-05-04** — `tsc-errors` 3179 → 3156 (−23 total: −10 prior-V9 headroom that had accumulated under V9-2.6/2.7/2.8 without baseline tightening, plus −13 directly from V9-3). The −13 from V9-3 break down as: 5 TS2322 (string assignability at `task.toolUseId`/`description` writes), 4 TS2363, 2 TS2345, 1 TS2365, 1 TS2362, scattered across `repl/components/tasks/{InProcessTeammateDetailDialog, BackgroundTasksDialog}`, `repl/components/Spinner{,/TeammateSpinnerLine}.tsx`, `repl/hooks/useScheduledTasks.ts`, `swarm/runtime/inProcessRunner.ts:923,1169,1220`, `swarm/runtime/spawnInProcess.ts:252,253`, `tool-registry/tools/TaskOutputTool.tsx:91`. **Counter-intuitive observation**: zero swarm-internal TS2339s were eliminated (65 → 65); the 65 are unrelated `Partial<unknown>` / `'CoreTool'` / `'unknown'` patterns in createSwarmHostDeps and InProcessBackend that come from OTHER V7 §7.2 type-side shims still in `swarm/adapters/appRuntime.ts`. Future iterations of §4 may chip at those. |
| V9-2c | §4 | Triaged remaining 11 unknown shims in `swarm/adapters/appRuntime.ts` by ACCESS-vs-CONSTRUCTION pattern. **Two narrowed**: `ToolUseContext` ← `tool-registry/Tool.ts:158` (−24 errors), `Message` ← `agent/messageShapes.ts:34` (−9 errors). Three tested-and-reverted (CONSTRUCTION pattern, zero yield): `AgentContext`, `TeammateContext`, `Task`. Six others still pending pattern-triage. | Low (per-shim type-only re-exports) | **✅ landed 2026-05-04** — `tsc-errors` 3156 → 3123 (−33). New rule discovered: only ACCESS-pattern unknown shims yield TS error elimination via narrowing; CONSTRUCTION-pattern produces zero yield because `unknown` already accepts every literal. Memory: `feedback_only_access_pattern_unknown_shims_yield.md`. |

### Remaining V9 phases (not yet executed)

| Phase | Section | Scope | Risk | Estimated effect |
|-------|---------|-------|------|------------------|
| V9-2b | §4 | `tool-registry/progressTypes.ts` 11 slots → `import type` | Low | ~20 TS2339 |
| V9-2c | §4 | `swarm/adapters/appRuntime.ts` 13 remaining slots → `import type` (after V9-3, TaskStateBase already done; remaining: PermissionMode/Task/AgentDefinition/Message/CustomAgentDefinition/AgentToolResult/AgentProgress/PermissionDecision/AgentContext/PermissionUpdate/TeammateContext/AppState shims). Each must be evaluated separately for whether the canonical home is import-safe. | Medium | ~30 TS2339 + some TS2345 |
| V9-2d | §4 | `cli/src/headless.ts` 5 slots → `import type` | Low | ~15 TS2339 |
| V9-4 | §4 | Remaining ~60 misc slots, case-by-case | Medium | ~50 TS2339 |
| V9-5 | §1+§2 result | Final ratchet tighten + retire `_deps.ts` lazy-require infra | Low | 0 (cleanup) |

After all V9 phases complete, the expected end state:
- `_deps.ts`: 0 lazy-requires, 0 unknown slots (✅ already achieved at V9-2.5)
- tsc-errors: target ~2900 (currently 3156 after V9-3; remaining −256 to budget across V9-2b/c/d, V9-4)
- 95 `= unknown` aliases reduced to <20 (those genuinely opaque at the runtime adapter boundary)

## Non-goals (Linus discipline)

- **Do not rename `AppStateCompat.ts` → `AppState.ts`.** It's pure
  cosmetic churn; no TS errors fixed; rename without correctness gain
  is anti-Linus. The original "Compat" suffix is misleading naming
  but renaming touches 37 importers for zero benefit.
- **Do not try to fix the 1429 TS18046 / 484 TS2339 errors directly.**
  Most are decompilation widening that V9-2's `import type` rewrite
  will fix as a side effect at consumer sites.
- **Do not delete any `= unknown` alias without a real-type
  replacement.** The alias is part of the V7 §7.2 contract; deleting
  causes an immediate TS2459 (no exported member) at every consumer.
- **Do not merge phases.** Each ships independently with its own
  ratchet tighten. V8's discipline came from "land each shrink on
  its own".
- **Do not chase per-file type purity.** A widened type at a
  setter signature that survives 12 V8 audits without a real bug is
  not technical debt — it's the cost of layering compromise.

---

## §1. `executeShellCommandsInPrompt` — the last lazy-require in `config/plugin/_deps.ts`

> **✅ V9-1 LANDED 2026-05-04** — `verify-deps-quality` ratchet now
> reports `lazyRequires=0`. The actual fix was simpler than this
> section originally proposed; see "Realised solution" at the bottom.

### Current state (2026-05-04)

`packages/config/plugin/_deps.ts:846-874` contains a `require()`-based
fallback. Default returns `prompt` (passthrough), which silently
strips every `!cmd` shell-substitution from plugin command bodies if
command-runtime fails to load.

### Caller graph

| Caller | Path | Notes |
|--------|------|-------|
| `loadPluginCommands.ts` | `config/plugin/loadPluginCommands.ts:27,378` | Forced through `_deps.ts` — config cannot import command-runtime (layering rule). **This is the only caller that needs the lazy fallback.** |
| `loadSkillsDir.ts` | `command-runtime/skills/loadSkillsDir.ts:58,375` | Same package import. Direct, no shim. |
| `security-review.ts` | `agent/commands/security-review.ts:3,215` | agent → command-runtime, valid downward direction. |
| `commit.ts` | `agent/commands/commit.ts:3,67` | Same. |
| `commit-push-pr.ts` | `agent/commands/commit-push-pr.ts:7,134` | Same. |
| `installPluginBindings.ts` | `app-host/runtime/installPluginBindings.ts:325-326` | Wires the setter back into `_deps.ts`. |

### Real dependencies of the canonical impl
(`command-runtime/src/promptShellExecution.ts`)

- `tool-registry/Tool.js` — `Tool`, `ToolUseContext` types
- `tool-registry/tools/BashTool/BashTool.js` — `BashTool`
- `tool-registry/tools/PowerShellTool/PowerShellTool.js` — `PowerShellTool` (lazy require)
- `local-observability/debug.js` — `logForDebugging`
- `local-observability/errorHelpers.js` — `errorMessage`, `MalformedCommandError`, `ShellError`
- `agent/frontmatterParser.js` — `FrontmatterShell` type
- `agent/messages.js` — `createAssistantMessage`
- `permission/permissions.js` — `hasPermissionsToUseTool`
- `storage/toolResultStorage.js` — `processToolResultBlock`
- `shell/legacy/shellToolUtils.js` — `isPowerShellToolEnabled`

### Why "move it down to config" is the wrong fix

The canonical impl pulls in `tool-registry`, `permission`,
`agent/messages`, and `storage` — none of these can be imported
from `config` without breaking layering. Sinking the function would
also sink its entire dependency cone, which would make `config`
the heaviest package in the graph. Wrong direction.

### Correct V9 fix — wire it as a host binding

`config` already has `ConfigHostBindings` (see
`packages/config/contracts.ts`) with ~40 binding slots wired by
`installConfigHostBindings()`. Add one more:

```ts
// in packages/config/contracts.ts
executeShellCommandsInPrompt?: (
  prompt: string,
  context: ToolUseContext,
  slashCommandName: string,
  shell?: FrontmatterShell,
) => Promise<string>
```

Then:

1. **Wire** in `app-host/runtime/installConfigHostBindings.ts` (or
   the equivalent setup point) — point at
   `command-runtime/promptShellExecution.executeShellCommandsInPrompt`.
2. **Switch the caller** in `config/plugin/loadPluginCommands.ts`
   from `executeShellCommandsInPrompt(...)` (deps shim) to
   `getConfigHostBindings().executeShellCommandsInPrompt?.(...)`.
   If the binding is missing, return `prompt` unchanged (same
   default as today's deps fallback).
3. **Delete** the lazy-require block in `_deps.ts` (lines 846–874)
   and the public re-export (lines 885–894). Update
   `setExecuteShellCommandsInPromptFn_` setter — keep it for
   backwards-compat one release, then drop.
4. **Re-tighten** `verify-deps-quality` — `lazyRequires: 0`.

### Risk assessment

- **Breakage radius**: 1 caller (`loadPluginCommands.ts`). The other
  callsites import command-runtime directly and don't go through
  `_deps.ts`.
- **Test coverage**: `command-runtime/__tests__/promptShellExecution.test.ts`
  exercises the real impl; new test needed for the host-binding
  fallback path (binding missing → passthrough returns prompt).
- **Rollback**: single PR, single revert if anything regresses.

### Why this is V9 territory and not V8.x

The cost is not large (one binding wire, one caller switch, one
delete). The reason it was deferred is **risk asymmetry**: a wrong
fallback returning `prompt` looks identical at boot but breaks
plugin shell substitution silently. V8.x policy was "no cosmetic
moves" — it's been queueing for V9 because V9 is when the
correctness-vs-effort trade flips (V9 is the type-cleanup pass that
makes the binding's signature visible at every callsite).

### Realised solution (V9-1, 2026-05-04)

The "add a ConfigHostBindings slot" proposal above turned out to be
**over-engineering**. On reading the actual code:

1. `_deps.ts:858`'s `require()` was NOT a cycle-break. The real
   wiring already runs at `installPluginBindings.ts:323-327`, which
   uses the same deferred-`require()` pattern that all sibling
   setters use. That pattern alone breaks the static cycle.
2. `_deps.ts:858`'s `require()` was a **defensive fallback** for the
   case where `installPluginBindings` hadn't run. But that fallback
   was dead code: even if `command-runtime/promptShellExecution.js`
   loaded, the function it loaded depends on 16 cross-package
   symbols (`BashTool`, `hasPermissionsToUseTool`,
   `processToolResultBlock`, `createAssistantMessage`, etc.). All 16
   are also on the host-binding wire. Without host setup, none
   resolve. The fallback "saved" no caller.

So V9-1 was just one minimal edit:

```ts
// Before — _deps.ts lines 846-874
let _cachedExecuteShellCommandsInPrompt: ... | null = null
const [_get..., setExecuteShellCommandsInPromptFn_] = makeSetter(
  async (prompt, ...rest) => {
    if (_cachedExecuteShellCommandsInPrompt == null) {
      try {
        const mod = require('@claude-code/command-runtime/promptShellExecution.js') as ...
        if (typeof mod.executeShellCommandsInPrompt === 'function') {
          _cachedExecuteShellCommandsInPrompt = mod.executeShellCommandsInPrompt
        }
      } catch { /* fall back to passthrough */ }
    }
    return _cachedExecuteShellCommandsInPrompt
      ? _cachedExecuteShellCommandsInPrompt(prompt, ...rest)
      : prompt
  })

// After — same setter, honest passthrough default
const [_get..., setExecuteShellCommandsInPromptFn_] = makeSetter(
  async (prompt, ..._rest) => prompt,
)
```

- `installPluginBindings.ts` unchanged — its existing setter call
  still wires the real impl at startup.
- `loadPluginCommands.ts` caller unchanged — it imports the public
  forward function from `_deps.ts`, which still works.
- No new `ConfigHostBindings` slot. No caller switch. No new
  contract type.
- Result: `verify-deps-quality` lazy-requires 1 → 0.
- doctor:arch 77/77, bun test 8217/0, build 13.58MB, --version
  26.5.17 — all unchanged.

This is the cleanest "remove the dead defensive code" outcome
imaginable. The V9 plan called for adding a host binding; the
realised V9-1 just deleted what was already redundant.

**Lesson for V9-2 onwards**: walk the actual code first. The
"obvious" host-binding refactor for `_deps.ts` slots may turn out
to be a delete-redundant-fallback for some of them too. The 6
unknown-typed slots in §2 still need `import type` narrowing
(that's compile-time work that can't be replaced by deletion), so
this lesson doesn't directly apply there. But it WILL apply to
subsequent slots in V9-2d / V9-3 — always read first.

---

## §2. `_deps.ts` 6 unknown-typed setter slots

> **✅ V9-2 + V9-2.5 + V9-2.6 + V9-2.7 + V9-2.8 + V9-2c LANDED 2026-05-04**
>
> - V9-2 + V9-2.5: 11 dead slot pairs deleted (8 bare unknown +
>   3 `() => unknown` survivors). `verify-deps-quality` ratchet
>   now reports `unknownSlots=0`.
> - V9-2.6: a real bug — `isDuplicatePath` was `(a, b) => a === b`
>   while every caller passed 3 args. Plugin-loader symlink-aware
>   path-dedup silently never fired. Fixed: real impl + test.
>   See "V9-2.6: caller-counting found a real bug" section below.
> - V9-2.7: 4 more dead exports + a SECOND broken-stub bug
>   (`coerceDescriptionToString` 1-arg returning `''` instead of
>   the real 3-arg impl returning `null`, breaking the `??`
>   fallback chain at 5 plugin-loader callsites). Fix: re-export
>   the real impl. Test added. See "V9-2.7: delete-and-discover"
>   section below.
>
> Earlier sections of this §2 (Inventory table with 6 rows, "Why
> these are unknown today", "Dead-on-arrival realisation") are
> retained for historical context. The "Original `import type`
> plan" at the bottom of §2 is the OBSOLETE version — kept to show
> the plan's evolution but **NOT** to be executed.

### Inventory (lines 490-548 of `packages/config/plugin/_deps.ts`)

| Slot | Wired in `app-host/.../installPluginBindings.ts` from | Real type at the source | Caller count |
|------|-------------------------------------------------------|-------------------------|--------------|
| `_agentColorManager` | `tool-registry/tools/AgentTool/agentColorManager.js` | `typeof import('...agentColorManager.js')` (module exports object) | **0** |
| `_fileEditConstants` | `tool-registry/tools/FileEditTool/constants.js` | `typeof import('...constants.js')` | **0** |
| `_fileReadPrompt` | `tool-registry/tools/FileReadTool/prompt.js` | `typeof import('...prompt.js')` | **0** |
| `_fileWritePrompt` | `tool-registry/tools/FileWriteTool/prompt.js` | `typeof import('...prompt.js')` | **0** |
| `_skillToolPrompt` | `tool-registry/tools/SkillTool/prompt.js` | `typeof import('...prompt.js')` | **0** |
| `_pluginOperations` | `config/plugin/pluginOperations.js` | `typeof import('./pluginOperations.js')` | **0** |

### Why these are `unknown` today

`config/plugin/_deps.ts` cannot statically `import` from `tool-registry`
(layering rule — config is below the tool layer). The runtime
binding goes through `installPluginBindings()`, but the static
type was widened to `unknown` rather than narrowed because the
file authors didn't see the `import type` escape hatch.

### Dead-on-arrival realisation (2026-05-04)

A repo-wide grep of the 6 `getXxx()` accessors returned **zero
callers**:

```
$ rg 'getAgentColorManager|getFileEditConstants|getFileReadPrompt|getFileWritePrompt|getSkillToolPrompt|getPluginOperations' packages/
# (no matches outside _deps.ts)
```

The setter functions ARE called once each from
`installPluginBindings.ts:507-537`, but the getter functions are
called **nowhere**. The slots are wire-only — values flow in, but
no consumer reads them.

This is V8-cleanup residue: at some point during V7 / V8 these
slots were used, the consumers got migrated to direct imports
(probably part of the V8 §3.2 cycle-break work), and the dead
shim survived. Knip didn't catch it because the setters ARE used
(in `installPluginBindings.ts`) — knip only flags fully-unused
exports.

### Revised V9-2 plan — ✅ LANDED 2026-05-04

Skipped the `import type` rewrite — pure deletion turned out correct.

**Final V9-2 + V9-2.5 deletion**:

1. `_deps.ts`: deleted 11 dead slot+getter+setter triples
   (8 unknown bare slots + 3 `() => unknown` LSP/MCP getter pairs).
   Net: ~95 LOC removed.
2. `installPluginBindings.ts`: deleted 11 imports + 11 setter wire
   calls. Removed 7 cross-package `require()` calls plus 1 require
   pointing at the long-gone `src/services/mcp/envExpansion.js`
   (V7 era). Net: ~75 LOC removed.
3. `verify-deps-quality` baseline tightened: `lazyRequires=0`,
   `unknownSlots=0`. Both rachets fully discharged for the bare
   unknown pattern.

**Important correction during execution**: Earlier this section
claimed only 6 unknown slots. Real grep showed 8 — `_getCharBudget`
and `_loadAgentsDir` ALSO had zero callers despite their typed
default callbacks. The forwarder functions `getCharBudget()` and
`loadAgentsDir(...)` are public from `_deps.ts` but no one outside
imports them; consumers reach into `tool-registry/.../loadAgentsDir.js`
and `tool-registry/.../SkillTool/prompt.ts` directly.

**Bonus dead code (V9-2.5)**: After deleting the 8 slots, a follow-up
grep on remaining `() => unknown` patterns surfaced 3 more dead
LSP/MCP getter pairs that the verifier's regex (`^let _<name>: unknown\b`)
didn't catch because their type was `() => unknown`. All deleted
in the same iteration.

**Verification**:
- `bun run scripts/verify-deps-quality.ts`: lazy-requires=0
  (baseline 0), unknown-slots=0 (baseline 0)
- `bun run doctor:arch`: 77 passed / 0 failed / 0 missing
- `bun test`: 8217 pass / 0 fail
- `bun run build`: dist/cli.js 13578720 bytes (down ~3KB from
  V9-1's 13581598; pure dead-code-elimination win)
- `bun dist/cli.js --version`: 26.5.17 (Claude Code)

### Why this is safe

- No reads → deletion can't break a consumer.
- The setters' side effects were just store-into-private-vars; no
  side effect leaks (no event fire, no log write, no global state
  mutation).
- The `require()` calls in `installPluginBindings.ts` for the 6
  slots also disappear (they were eagerly resolving the modules just
  to pass them into setters that nothing reads). This may shrink
  startup by a few ms.
- Build, test, doctor:arch — all should pass unchanged.

### Risk: a future caller that was about to use these

Possible but low. The fact that these slots have been dead for
multiple V8 iterations + are not referenced from any pending PR or
TODO comment suggests they're stale. If a future feature needs the
same shape, the `import type` pattern from §3 onwards is the right
template — re-creating these as Pure dead-code-shaped slots would be
the wrong approach.

### Original `import type` plan, retained for reference

Below is the original V9-2 plan from earlier iterations, which
assumed the slots had real callers. Kept here for documentation —
do **not** execute. Use the deletion plan above instead.

### The fix is shallower than V9 host-binding consolidation

`import type` declarations are erased at emit and **do not introduce
a runtime dependency**. So:

```ts
// in _deps.ts
import type * as AgentColorManagerMod
  from '@claude-code/tool-registry/tools/AgentTool/agentColorManager.js'
let _agentColorManager: typeof AgentColorManagerMod | null = null
export function setAgentColorManagerFn(v: typeof AgentColorManagerMod): void {
  _agentColorManager = v
}
export function getAgentColorManager(): typeof AgentColorManagerMod | null {
  return _agentColorManager
}
```

This satisfies the layering rule (no runtime import) AND gives the
slot a real type. The downstream tsc errors at every `getXxx().y`
access site collapse from "Property 'y' does not exist on type
'unknown'" to a normal property access.

### Risk assessment

- **Breakage radius**: zero runtime changes. Compile-time only.
- **Knock-on effect**: probably 50–100 TS2339 errors at consumers
  go away. The exact count needs to be measured during the change.
- **Test coverage**: existing `_deps` setter tests verify wire-up;
  the type change adds no new behaviour to test.
- **Rollback**: trivially reverts (single-file change in `_deps.ts`).

### Why this can land before V9 proper

This is a **type-only refactor inside `_deps.ts`** that doesn't
move the binding architecture. It can land in V8.x and tighten the
ratchet (`unknownSlots: 6 → 0`) without depending on the larger
host-binding work. Recommend doing this **before** the AppState
unification in §3 because the AppState work depends on a clean
binding-typing story.

### V9-2.6: caller-counting found a real bug, not just dead code

The same caller-counting grep that surfaced V9-2's 11 dead
getter/setter pairs also surfaced a pure stub at `_deps.ts:875`:

```ts
// Before — broken
export function isDuplicatePath(a: string, b: string): boolean {
  return a === b
}

// Caller (loadPluginCommands.ts, loadPluginAgents.ts, loadPluginOutputStyles.ts):
const fs = getFsImplementation()
if (isDuplicatePath(fs, filePath, loadedPaths)) return  // 3 args!
```

The forwarder declared `(a, b)` but every caller passed `(fs, filePath,
loadedPaths)`. JavaScript silently drops extra args; the body
compared `fs === filePath` (always false because object ≠ string).
**Result: the symlink-aware path-dedup logic in plugin loaders never
fired**. Two different plugin paths pointing at the same physical
markdown file via symlink would each load the file as a separate
plugin entity. The actual symlink-resolving implementation lived in
`storage/fsOperations.ts:isDuplicatePath`, but `config/plugin/_deps`
can't import it directly without a layer-rule violation.

**Fix landed**:
- `_deps.ts:isDuplicatePath` rewritten with the real
  `realpathSync`-based logic, signature `(filePath, loadedPaths)` (2
  args).
- `node:fs.realpathSync` invoked directly via `require()` rather
  than through the wired `PluginFsImpl`. realpath is a pure
  syscall (name resolution, not state I/O) so the sandbox/virtual-fs
  abstraction adds no value here, AND going direct sidesteps a
  test-isolation hazard with module-level `_fs` slots.
- All 6 callsites in `loadPluginAgents.ts`,
  `loadPluginOutputStyles.ts`, `loadPluginCommands.ts` updated to
  drop the now-unused `fs` argument.
- Regression test added: `packages/config/plugin/__tests__/isDuplicatePath.test.ts`
  with 5 cases including symlink dedup and dangling-path fallback.

**Validation**:
- `bun test`: 8221 → 8222 (1 new test file with 5 cases).
- `bun run doctor:arch`: 77/77 unchanged.
- `bun run build`: dist/cli.js +66 bytes (real impl + try/catch
  + comment; the bytes are correctness, not bloat).

**Lesson**: caller-counting grep is more productive than verifier
detectors for finding bugs disguised as forwarders. The
verify-deps-quality ratchet looks at slot type shape, not at
caller-vs-forwarder arity. Future work could:
- Build an arity-mismatch verifier (scripts/verify-forwarder-arity.ts)
  that flags `_deps.ts` exports whose declared arity is less than
  the maximum caller arity.
- BUT: the V9-1 + V9-2 + V9-2.5 + V9-2.6 cleanup pass has likely
  exhausted the high-yield findings. The detector would lock the
  invariant against future drift, but the current state is already
  clean. Decide based on whether more `_deps.ts`-style files exist
  (they don't, per `find packages -name "_deps.ts"`).

### V9-2.7: delete-and-discover — same caller-counting found a SECOND broken stub

V9-2.7's plan was clean dead-code deletion: 4 exports flagged by
caller-counting (`safeParseJSON`, `BUILTIN_PLUGIN_IDS`,
`checkBinaryExists`-chain, plus the post-V9-2.6 stale
`storage/fsOperations.ts:isDuplicatePath`). Same plan as V9-2 — no
correctness change expected, just `~80 LOC` of dead removed.

I also flagged `coerceDescriptionToString` as dead (0 callers per
the import-path-filtered grep). On running `verify-build-resolves`
post-deletion: **build broke**. Five callers in
`config/plugin/loadPlugin{Agents,OutputStyles,Commands}.ts` had
been importing from `_deps.js` — my caller-count was wrong.

But the fix wasn't to put the dead stub back. Reading the local
stub at `_deps.ts:722`:

```ts
export function coerceDescriptionToString(v: unknown): string {
  if (typeof v === 'string') return v
  if (v == null) return ''
  return String(v)
}
```

vs the REAL impl at `config/frontmatterParser.ts:304`:

```ts
export function coerceDescriptionToString(
  value: unknown,
  componentName?: string,
  pluginName?: string,
): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  // Non-scalar — log and return null
  ...
}
```

**Different signature. Different return type. Different semantics.**
Caller at `loadPluginAgents.ts:94`:

```ts
coerceDescriptionToString(frontmatter.description, agentType) ??
  extractDescriptionFromMarkdown(...)
```

Caller's intent: invalid description → coerce returns `null` →
`??` fallback fires → `extractDescriptionFromMarkdown` provides
default. With the broken local stub: invalid description → returns
`''` → `'' ?? x` is `''` (`??` only triggers on `null/undefined`)
→ fallback NEVER fires → plugins ship with empty descriptions.

**Same bug class as V9-2.6 isDuplicatePath**: a local stub silently
shadowing a real impl, with arity AND return-type mismatch, breaking
caller logic without any test or type error.

Fix: replace the local stub with `export {
coerceDescriptionToString } from '../frontmatterParser.js'`. Caller
imports stay unchanged (still from `./_deps.js`); now they get the
real 3-arg impl that returns `string | null`. Regression test added
at `packages/config/plugin/__tests__/coerceDescriptionToString.test.ts`
(7 cases), notably:

- `null` input → `null` (NOT `''`)
- empty/whitespace string → `null` (NOT `''`)
- objects/arrays → `null` (NOT `[object Object]`)

**Validation**:
- `bun test`: 8222 → 8229 (1 new file, 7 cases)
- `doctor:arch`: 77/77
- `verify-deps-quality`: lazy=0, unknown=0 (unchanged)
- `bun run build`: dist/cli.js -1840 bytes (real DCE)

**Lesson**:
1. The "delete dead code" plan can surface live bugs when the
   "dead" code is actually a stub shadowing the real impl. **Always
   run build-resolves after each deletion**, not just at the end.
2. Caller-counting via grep CAN miss callers when filter logic
   is too aggressive (here: I filtered out `_deps.js` callers when
   I should have filtered out non-`_deps.js` callers). When in
   doubt, run with NO filter and inspect each line.
3. Same broken-stub pattern hit twice (V9-2.6 + V9-2.7) — strongly
   suggests `_deps.ts` was hand-typed at V7 from incomplete
   memory of the real impls. Worth a pass to look for more
   broken stubs whose return values would silently miscompare:
   any local impl where signature doesn't match every caller's
   call shape is suspect.

---

## §3. `AppState` vs `AppStateCompat` — earlier hypothesis was wrong

### Inventory

```
packages/app-host/src/state/
├── AppStateCompat.ts   ← REAL canonical (453 lines, type + default state)
├── AppStateStore.ts    ← pure re-export proxy of AppStateCompat
└── AppState.tsx        ← React Provider + ALSO re-exports type from AppStateStore
```

Caller count by entry point:
- `from '@claude-code/app-host/state/AppState.js'` — 27 importers (type-only + React hooks/Provider)
- `from '@claude-code/app-host/state/AppStateStore.js'` — 6 importers (type-only)
- `from '@claude-code/app-host/state/AppStateCompat.js'` — 1 direct + 2 internal references

### What the earlier hypothesis got wrong

The post-V8 baseline doc (and my own iteration-2 V9 plan) claimed
the ~439 TS2322 errors come from "AppState vs AppStateCompat
structural duplication". **Wrong.** There is no structural
duplication — only a 3-file re-export chain ending at
`AppStateCompat.ts`. The "Compat" suffix is misleading naming, not
a parallel type definition.

### Where the TS2322 errors actually come from

Top file by TS2339 count is `cli/.../run-streaming.ts` (139), and
its TS2322s are at structural identity boundaries between
`packages/repl/src/tasksTypes.ts:TaskState` union and
`packages/cli/.../run-streaming.ts:TaskState` union. **The double
union there**, not AppState. Iter-27's commit comment says exactly
this:

> 2026-04-30 (Phase O): bumped 3226 → 3223 after loosening
> `isBackgroundTask` input to the structural shape that the agent
> framework's narrow TaskState already satisfies — closes the two
> run-streaming.ts assignability errors

So the real V9 phase 5 work is:

1. **Rename canonical**: move the 453 LOC of `AppStateCompat.ts` into
   `AppState.ts` (drop `.tsx` from current `AppState.tsx`, rename
   the React Provider file to `AppStateProvider.tsx`). This is
   purely cosmetic — no TS errors fixed, no runtime change. Pure
   naming hygiene. Probably not worth the churn.
2. **Audit TaskState double-union** in `tasksTypes.ts` and
   `run-streaming.ts`. This is the real source of the structural
   identity errors. Either (a) make one a Pick<the other>, or (b)
   route both through a shared type at a leaf package.
3. **Re-classify the TS2322 distribution** — the post-V8 doc's
   estimate was based on the bad hypothesis. Run a fresh per-file
   count of TS2322 to find the actual hot spots before designing
   any unification work.

### Risk assessment of the rename (option 1)

- **Breakage radius**: 37 importers across 9 packages. All are
  string path imports — pure mechanical sed.
- **Test coverage**: AppState provider behavior is exercised in
  REPL render tests; type re-exports have no behavior to test.
- **Rollback**: rename is reversible by another rename.
- **Real value**: zero — no TS errors fixed. Only readability.

### Conclusion: drop the rename, focus on TaskState

Rename without correctness gain is anti-Linus. The TaskState audit
(option 2) is where the actual TS2322 reduction lives. **V9 §3 is
re-scoped to "audit and unify TaskState double-unions"**, not
"unify AppState/AppStateCompat".

---

## §4 + §5. `= unknown` placeholder ecosystem (95 total)

### Scope

A repo-wide grep found **95 `export type X = unknown` declarations**
across 20+ files. The biggest clusters:

| File | Count | Purpose |
|------|-------|---------|
| `swarm/adapters/appRuntime.ts` | 13 | V7 §7.2 boundary shim — types injected by `installAgentSwarmBindings()` at runtime |
| `tool-registry/progressTypes.ts` | 11 | Progress event union slots; real shapes per tool live in each tool's package |
| `cli/src/headless.ts` | 5 | SDK consumer types delegated to `mcp-runtime`/`provider`/`headless-sdk` |
| `ide/src/lsp/types.ts` | 3 | LSP client types — wired from external LSP packages at host time |
| `swarm/adapters/appUi.ts` | 2 | UI permission types injected from `permission` |
| `voice/src/appStateHooks.ts` | 1 | AppState shim using V7 §7.2 lazy require |
| (rest) | ~60 | Various leaf shim types in repl/config/command-runtime |

### Earlier "4 placeholders to remove" claim was wrong

iteration-1's V8 baseline doc and iteration-2's V9 §4 plan both
treated the 4 `cli/src/headless.ts` `= unknown` aliases as "dead
deletable types". **Wrong.** They are the **type-side of the V7 §7.2
host-binding pattern**:

- Runtime: `installCliHostBindings()` populates real values via
  setter functions in `app-host`.
- Compile time: the package can't statically `import` from
  `mcp-runtime`/`provider`/etc. (would violate layering), so the
  type slot becomes `unknown` and consumers cast at use site.

This is a **deliberate architectural pattern**, not technical debt.
What looks like "type erasure" is actually "compile-time layer
isolation".

### What's actually achievable with `import type`

The same `import type` trick that works for `_deps.ts` (§2) works
here. Because `import type` is erased at emit, it does NOT introduce
a runtime dependency — so it doesn't violate the layer rule. The 95
slots can be progressively rewritten:

```ts
// Before (V7 §7.2 type-side):
export type AgentDefinition = unknown

// After (V9 type-narrowed):
import type { AgentDefinition as RealAgentDef }
  from '@claude-code/headless-sdk/agentSdkTypes.js'
export type AgentDefinition = RealAgentDef
```

But this needs **per-file judgment**:

1. **Direct re-mapping (low risk)**: when there's exactly one canonical
   home with the same name. ~30–40 of the 95 slots qualify.
2. **Union of multiple sources (medium risk)**: when the real type is
   spread across package families (e.g., `Tool` exists in
   `tool-registry`, but its progress events live in 11 different
   files). Needs a unification step.
3. **Truly opaque (keep as `unknown`)**: when the runtime binding
   doesn't have a static counterpart (e.g., the swarm tasks that get
   injected by external orchestration adapters). Keep `unknown` and
   document why.

### Why this is V9-1 work and not V8.x

`_deps.ts` (§2) had only 6 slots in 1 file with 1 binding source.
That's mechanical. The 95-slot ecosystem requires:

- Reading each slot's setter call to identify the real type home.
- Confirming `import type` doesn't accidentally introduce a runtime
  dep via TS reflection patterns.
- Running tsc after each batch to confirm we're moving the unknown
  cone, not relocating it.

**Recommended V9 phase split**:

- **V9-2a**: rewrite the 11 slots in `tool-registry/progressTypes.ts`
  (single file, one tool family per progress type)
- **V9-2b**: rewrite the 13 slots in `swarm/adapters/appRuntime.ts`
- **V9-2c**: rewrite the 5 slots in `cli/src/headless.ts`
- **V9-2d**: case-by-case for the remaining ~60 across small files

Each phase ships independently with its own tsc-baseline tighten.

### Reverse-direction risk

If V9-2 is done carelessly, the unknown cone shifts to consumer
sites: instead of "1 file declares unknown, 50 consumers cast", we
get "50 consumers each declare their own unknown narrowing". The
correct workflow is:

1. Identify the canonical type's home.
2. Rewrite the alias as `import type X from <home>`.
3. Run tsc — count of TS18046/TS2339 should DROP at consumer sites.
4. If it doesn't drop (i.e., the unknown cone moved up), revert and
   the alias was holding back a structural conflict, not a type-rot.

This is why V9-2 needs to be incremental and gated on tsc deltas.

---

## Rollback feasibility per phase

Each V9 phase MUST satisfy three conditions to ship:

1. **Atomic land**: single PR, single commit revertable in isolation.
2. **Independent tsc baseline**: each phase tightens its own ratchet
   without depending on other phases having landed.
3. **No silent breakage**: tsc count must visibly drop after the
   phase, OR the phase explains why the move is structural-only.

### V9-1 (`executeShellCommandsInPrompt` → host binding)

- **Atomic**: ✓. Single binding wire, single caller switch, delete
  the lazy-require block.
- **Independent**: ✓. Doesn't depend on §2/§3/§4.
- **Rollback**: Revert restores the `_deps.ts` lazy-require block.
  Existing setter `setExecuteShellCommandsInPromptFn_` is preserved
  for one release as belt-and-suspenders.
- **Test gate**: existing `loadPluginCommands` plugin loader test
  catches the host binding wire bug (would silently revert to
  passthrough, plugin shell substitution disappears).
- **Verdict: SAFE**.

### V9-2a (`tool-registry/progressTypes.ts` 11 slots)

- **Atomic**: ✓. Single file, all 11 slots in one commit.
- **Independent**: ✓. progressTypes.ts has no setter wiring —
  slots are union members, not host bindings. Pure compile-time.
- **Rollback**: Single git revert.
- **Test gate**: tsc must drop at least N TS2339/TS18046 errors at
  the 11 progress consumer sites (each progress event is consumed
  by 2–4 places). If tsc doesn't drop, a real type conflict was
  hidden — revert and investigate.
- **Verdict: SAFE** if tsc drops. **REVERT** if tsc doesn't drop.

### V9-2b (`swarm/adapters/appRuntime.ts` 13 slots)

- **Atomic**: ✓. Single file.
- **Independent**: ✓. The setter side is in
  `installAgentSwarmBindings()` and isn't touched.
- **Rollback**: Single git revert.
- **Test gate**: harder than V9-2a — `swarm` consumes these in many
  places (inProcessRunner.ts: 27 errors). The drop will be the
  largest of any phase. If tsc INCREASES (cascade error from a real
  conflict surfacing), revert immediately.
- **Verdict: MEDIUM RISK**. Recommend doing V9-2a first to learn the
  pattern, before tackling this larger surface.

### V9-2c (`cli/src/headless.ts` 5 slots)

- **Atomic**: ✓.
- **Independent**: ✓. cli is a leaf package; all 5 slots have
  unambiguous canonical homes (mcp-runtime, provider, headless-sdk).
- **Rollback**: Single git revert.
- **Test gate**: SDK integration tests (cli/src/headless/sdk/__tests__)
  will catch type contract mismatches.
- **Verdict: SAFE**.

### V9-2d (remaining ~60 misc slots)

- **NOT a single phase.** Each cluster of 3–10 slots ships as its
  own micro-phase with its own ratchet.
- **Composable atomic**: each micro-phase is independent of others.
- **Rollback**: per-cluster.
- **Verdict: SAFE one-cluster-at-a-time, UNSAFE if batched.**

### V9-3 (TaskState double-union)

- **Atomic**: ✓. Single PR that unifies the two TaskState unions.
- **Independent**: depends on V9-2b having landed (swarm's TaskState
  consumers want clean unknown→Task narrowing first).
- **Rollback**: Single git revert. The before-state is structurally
  valid (just has parallel unions); revert restores it.
- **Test gate**: cli/headless/sdk/session/run-streaming.ts tests +
  swarm/runtime/inProcessRunner.ts tests. Both have non-trivial
  TaskState handling.
- **Verdict: MEDIUM-HIGH RISK**. Stage after V9-2b validates the
  pattern. Consider per-package incremental TaskState narrowing if
  whole-PR is too risky.

### V9-5 (cleanup)

- After V9-1 through V9-3 land: tighten the
  `verify-deps-quality` ratchet (`lazyRequires: 0, unknownSlots: 0`),
  the `verify-tsc-errors` budget (3179 → ~2900 expected), and
  archive any remaining V9-PENDING markers.
- **Verdict: SAFE** (cleanup only).

### Common rollback escape hatches

If any phase causes unexpected breakage:
- Tag tracker: `git tag v9-N-pre` before the phase, `git tag v9-N-post`
  after. Reverting becomes `git revert v9-N-post..v9-N-pre`.
- The ratchet tightens AFTER the phase passes doctor:arch — if a
  later phase regresses, the previous baseline is still preserved
  in `scripts/*-baseline.json` git history.
- `--tighten` on every ratchet is idempotent; never forces a value.

---

## How to use this doc

- **Before V9 work starts**: this doc replaces the inventory step
  for the next ralph-loop session. Just pick V9-1, execute, validate
  with the test gate, ratchet tighten.
- **During V9 work**: update each section's status (✓ landed) and
  link to the commit SHA.
- **After V9 ends**: archive to `docs/_archive/v9-refactor/` like
  the V7 retrospective. Set the next post-V8-baselines update.

## Referenced from

- `CLAUDE.md` — "V9 territory" mentions
- `docs/refactor/post-V8-baselines.md` — "What was NOT done"
- `docs/refactor/tsc-error-classification.md` — TS2322 / TS18046 paths
