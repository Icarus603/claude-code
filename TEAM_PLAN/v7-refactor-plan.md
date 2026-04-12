# V7 Refactor — Master Plan

> **Source of authority:** `V7.md` (架構規則) + `bun run doctor:arch` (live status). This file is the **execution plan** that bridges the two — it does not redefine the rules and does not claim "phases done"; it lists work, verifiers, and exit criteria for each section so that any iteration can resume from `git status` + `doctor:arch --json`.

---

## 0. Verified Baseline (2026-04-12)

| Signal | Value | Source |
|---|---|---|
| `bun run doctor:arch` | **22 passed · 0 failed · 0 missing** | live |
| `bun test` | **2278 pass · 0 fail** (138 files, 920ms) | live |
| `bun run build` | **OK** — bundled 436 files to `dist/` | live |
| Pipe smoke `echo … \| bun run dev -p` | **OK** | live |
| `src/main.tsx` | **64 L** (target ≤200 ✓) | wc |
| `src/cli/print.ts` | **9 L** (target ≤50 ✓) | wc |
| `src/screens/REPL.tsx` | **19 L** (target ≤30 ✓) | wc |
| `src/query.ts`, `src/QueryEngine.ts`, `src/tools.ts`, `src/commands.ts` | **1 L facades** | wc |

### What "all green" hides

doctor:arch passes today **only because of transition budgets** in `scripts/verify-runtime-boundaries.ts`. The packages still pull owner logic from `src/*` via the `@claude-code/app-compat/*` tsconfig path-alias (which resolves to `./src/*`):

| Owner package | `@claude-code/app-compat/*` refs (budget) |
|---|---|
| `packages/agent` | **149** |
| `packages/config` | **116** |
| `packages/permission` | **88** |
| `packages/memory` | **84** |
| `packages/provider`, `cli`, `tool-registry`, `command-registry`, `mcp-runtime` | 0 |
| **Total drainage required** | **437** |

V7 §17 calls this exactly: "搬完 vs 真的搬完" — root files are 1-line facades, doctor passes, but the implementation still lives at root and the package re-imports it via `app-compat`. **Until the budgets are 0, the lower waves are not actually done** — they are scaffolded.

### What is structurally missing

| V7 § | Requirement | Current state |
|---|---|---|
| §6.5 | 8 typed error namespaces (`ProviderError`, `PermissionError`, `ToolError`, `McpError`, `StorageError`, `ShellError`, `ConfigError`, `UserAbort`) | **0/8** — only 2 ad-hoc error subclasses exist in the formal packages (memory/teamMemPaths.ts, claude-for-chrome-mcp) |
| §9.10 | `AgentEvent` is unified spine — every variant has `turnId` + `ts`, agent mints `turnId` at `turn-start` | **Shape mismatch** — `packages/agent/types/events.ts` defines a 12-variant union with no `turnId`/`ts`; `PermissionRequestEvent` carries a non-replayable `resolve()` callback |
| §9.11 | Each owner publishes `/testing` subpath with in-memory fakes | **0/9** — no package has a `testing/` subpath in `package.json#exports` |
| §3.7 | Every >50ms-blocking call accepts `signal: AbortSignal` | partial — provider/MCP runtime accept signals; tool-registry/permission/memory/storage do not consistently |
| §8 packages exist | `voice`, `bridge`, `daemon`, `repl`, `headless-sdk` | **0/5** — code still lives in `src/voice/`, `src/bridge/`, `src/daemon/`, `src/screens/`, `src/cli/headless/` |
| §19.4 | rename `command-registry` → `command-runtime` | **not done** |
| §10.4 Wave 0 Prep | empty-folder sweep | done (verifier passes) |

### src/ footprint (the real monolith)

```
src/ → 2,075 .ts/.tsx files / 473,143 lines / 45 top-level dirs
src/ → @claude-code/* imports: 809
packages/ → @claude-code/* imports: 483
```

src/ is still the dominant owner. packages/ are facades that re-import src/ via `app-compat`. The plan below inverts that.

---

## 1. Plan Shape

This plan respects V7 §10.4 strict leaf-first sequencing **and** WIP=1. Each item below is a *complete-or-revert* unit with a verifier that doctor:arch can score.

The numeric phases here map to V7 waves but are renumbered to match remaining work (since wave 6 of the original phases — host thinning — is already physically done):

| Phase | V7 Wave | Scope | Exit gate |
|---|---|---|---|
| **P0** | Wave 0 Prep | rename + scaffolds + 2 new verifiers | doctor:arch 24/24, all renames green |
| **P1** | Wave 1 leaves drain | `config` budget 116 → 0 (`local-observability` already 0) | runtime-boundaries STRICT mode for `config`, tsc-clean |
| **P2** | Wave 2 platform drain | `permission`, `memory`, `storage`, `output`, `shell` budgets all 0 | STRICT mode for all five |
| **P3** | Wave 3 domain core seams | `provider` + `tool-registry` + `command-runtime` get error namespaces + `/testing` subpaths + AbortSignal in public API | verify-error-namespaces, verify-testing-seams, verify-abort-signal pass for these three |
| **P4** | Wave 4 agent | `agent` budget 149 → 0; AgentEvent reshape with turnId/ts; agent error namespace; agent `/testing`; agent AbortSignal pass | event-spine verifier passes, agent STRICT mode |
| **P5** | Wave 5 integrations | `voice`, `bridge`, `daemon` packages created from `src/voice|bridge|daemon`; `mcp-runtime` and `swarm` get full §6.5/§9.11 treatment | each integration STRICT mode, WIP=1 serial |
| **P6** | Wave 6 hosts | `repl` and `headless-sdk` packages created; `src/components/` ownership-decomposed per §8.24; permission dialogs → `packages/permission/prompts`; tool render → `packages/tool-registry/render` | repl/headless-sdk STRICT mode |
| **P7** | Final hardening | dissolve `AppStateStore`; delete `@cc-app/*` and `@claude-code/app-compat/*` tsconfig path aliases; doctor:arch passes with **all budgets removed**; CI wires doctor:arch as required check | doctor:arch green with empty `TRANSITION_APP_COMPAT_REF_BUDGET` |

Ralph loop note: each iteration claims **one** in-progress task (WIP=1), executes it under §16 Refactor Playbook, and commits. If `doctor:arch` regresses, the iteration must `git revert` the chain and report — never fix-forward.

---

## 2. P0 — Wave 0 Prep (concrete commits)

P0 is the only phase where multiple small commits are allowed because every step is non-mutually-exclusive Wave 0 hygiene.

### P0.1 — Rename `command-registry` → `command-runtime` (V7 §19.4)

Single atomic commit. Steps in order:

```bash
# 1. physical move
git mv packages/command-registry packages/command-runtime

# 2. package.json name field
#    "@claude-code/command-registry" → "@claude-code/command-runtime"

# 3. workspace consumers
rg -l '@claude-code/command-registry' --type ts --type tsx
# Expected hits: src/commands.ts, scripts/verify-command-registry.ts, several
# packages/cli/* files, packages/agent/host.ts, packages/app-host/*.

# 4. verifier rename + script
git mv scripts/verify-command-registry.ts scripts/verify-command-runtime.ts
# Update CHECKS entry id in scripts/doctor-architecture.ts

# 5. transition budget map key
#    'packages/command-registry' → 'packages/command-runtime' in
#    scripts/verify-runtime-boundaries.ts (PACKAGE_PATHS list) and
#    scripts/verify-package-tsc-clean.ts (WATCHED_PATH_PREFIXES)

# 6. rebuild workspace links
bun install
bun test
bun run build
bun run doctor:arch
```

Verifier impact: zero (just a rename). Touches `command-runtime` only.

### P0.2 — Scaffold missing packages

Create empty workspace packages with minimal `package.json` + `src/contracts.ts` + `src/index.ts`. **No code move yet** — these are landing slots so V7 §10 has destinations.

```
packages/repl/         (V7 §8.24)
packages/headless-sdk/ (V7 §8.25)
packages/voice/        (V7 §8.20)
packages/bridge/       (V7 §8.21)
packages/daemon/       (V7 §8.22)
```

Each `package.json`:

```json
{
  "name": "@claude-code/<name>",
  "version": "0.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./contracts": "./src/contracts.ts",
    "./testing": "./testing/index.ts"
  },
  "dependencies": {}
}
```

Each `src/contracts.ts`:

```ts
// Empty — populated when this package starts owning real code.
// See V7 §8.<n> for the contract surface this package will host.
export {}
```

Each `src/index.ts`:

```ts
export * from './contracts.js'
```

Each `testing/index.ts`:

```ts
// In-memory fakes — populated alongside main implementation.
// See V7 §9.11.
export {}
```

Verifier additions (P0.4):
- `verify-empty-folders` already passes; no change.
- `verify-package-scaffolds.ts` (new): assert each of the 5 packages above is in workspaces and has `exports['.']`, `exports['./contracts']`, `exports['./testing']` declared.

### P0.3 — Tsconfig path additions

Add path aliases for the 5 new packages so `import { … } from '@claude-code/repl'` works during the migration.

```jsonc
"paths": {
  "src/*": ["./src/*"],
  "@cc-app/*": ["./src/*"],                   // existing — to be deleted in P7
  "@claude-code/app-compat/*": ["./src/*"],   // existing — to be deleted in P7
  "@claude-code/repl": ["./packages/repl/src/index.ts"],
  "@claude-code/repl/contracts": ["./packages/repl/src/contracts.ts"],
  "@claude-code/repl/testing": ["./packages/repl/testing/index.ts"],
  // ... same shape for headless-sdk / voice / bridge / daemon
}
```

### P0.4 — New verifier scripts

| Script | Function | Initial mode |
|---|---|---|
| `scripts/verify-testing-seams.ts` | Each owner package's `package.json#exports` declares `./testing`; that file exists; resolves; does not import its package's `internal/`. | Pending — registered with `--skip` until P3 |
| `scripts/verify-error-namespaces.ts` | Each owner exports a `BaseError` class plus the §6.5 subtype set. | Pending — registered with `--skip` until P3 |
| `scripts/verify-event-spine.ts` | `packages/agent/types/events.ts` exports an `AgentEvent` union where every variant has `turnId: string` + `ts: number`. | Pending — registered with `--skip` until P4 |
| `scripts/verify-abort-signal.ts` | AST-greps `packages/{agent,provider,tool-registry,mcp-runtime,permission,storage,shell}/**/*.ts` for exported async functions whose name matches `query|stream|exec|run|connect|fetch|read|write|prefetch|discover|executeTool` and asserts they accept a `signal: AbortSignal`. | Pending — registered with `--skip` until P3 |
| `scripts/verify-package-scaffolds.ts` | The five new packages are in `workspaces` and declare the standard exports. | Active immediately (P0.2 gate) |

All five register in `scripts/doctor-architecture.ts` `CHECKS` array. The `--skip` ones return `{ status: 'pending', reason: 'V7 wave gate' }` so they show up in `doctor:arch --list` but do not fail.

### P0.5 — Baseline snapshot

```bash
bun run doctor:arch --json > .baseline-doctor.json
git add .baseline-doctor.json
```

Commit per V7 §16.4: each step P0.1 / P0.2 / P0.3 / P0.4 / P0.5 is **its own commit**. P0 ends when all five commits are on `main` and `doctor:arch` reports 22+5 = **27 checks** (22 existing + 5 new), with the 4 wave-gated checks in `pending` and `verify-package-scaffolds` green.

---

## 3. P1 — Wave 1 leaves drain

Goal: `config` budget 116 → 0. (`local-observability` already 0.)

### Drain procedure (applies to every package)

For each `from '@claude-code/app-compat/<path>'` in the package:

1. Read the imported symbol from `src/<path>`.
2. Decide ownership per V7 §10.3:
   - **Move to package** if the symbol is config-domain logic (parsing, validation, watching, feature flags, managed sync).
   - **Cut the dependency** if the symbol is a host concern that the config package shouldn't know about (e.g. UI rendering of a settings dialog) — refactor the call site so config exposes a contract and the host implements it.
3. Move the file's contents to `packages/config/<subdir>/<file>.ts` per V7 §8.6 internal structure.
4. Replace the original `src/<path>` file with `export * from '@claude-code/config/<…>'`.
5. Update all `src/*` callers — they keep importing the old path (now a re-export facade), so this step usually adds 0 churn outside the moved file.
6. Run the verification suite:

```bash
bun run doctor:arch && bun test && bun run build && echo "hi" | bun run src/entrypoints/cli.tsx -p
```

7. If green: commit. If red: `git revert HEAD && git push origin main`, then report the failure mode.

### P1 exit gate

```bash
grep -c "@claude-code/app-compat" packages/config/**/*.ts   # → 0
```

`scripts/verify-runtime-boundaries.ts` `TRANSITION_APP_COMPAT_REF_BUDGET['packages/config']` is set to **0** in the same commit; `packages/config` is added to `STRICT_PACKAGE_PATHS`.

### P1 budget breakdown (target order — smallest blast radius first)

The plan walks `config` files in **dependency order, leaves first** so each commit narrows the cone. The order is computed by re-running `rg --files-with-matches '@claude-code/app-compat'  packages/config/`, sorting by ref count ascending, and taking the smallest first.

Estimated commit count: ~12 (average ~10 refs / commit). Each commit must keep budget non-increasing for every other package (no shifting work sideways).

---

## 4. P2 — Wave 2 platform drain

Goal: `permission` 88 → 0, `memory` 84 → 0, `storage` ≥ 0 (must stay 0), `output` 0, `shell` 0.

`storage`, `output`, `shell` are already 0 — P2 enforces they stay there while `permission` and `memory` drain.

### Strict order (V7 §10.4 WIP=1, no parallel)

1. `permission` — drain 88 → 0
2. `memory` — drain 84 → 0
3. (verification only) `storage`, `output`, `shell` — turn on STRICT mode

### Per-package internal structure target (V7 §8)

When draining, files land in the V7 §8 directory shape, not flat under `src/`:

```
packages/permission/
  contracts/      (PermissionContext, PermissionResult, PolicyInput, CapabilitySet, PermissionError)
  rules/          (parse, normalize, persist, source precedence)
  pipeline/       (rule eval, auto classifier, tool input safety)
  prompts/        (permission prompt schemas + prompt result mapping)
  filesystem/     (path safety, working directory policy)
```

Refactor moves are `git mv` then `find packages/permission -name '*.ts' -exec rg -l 'old/path' {} +` to update intra-package imports. Bias towards smaller commits over large refactors — each commit is one logical move.

### P2 exit gate

```bash
for p in permission memory; do
  grep -c '@claude-code/app-compat' packages/$p/**/*.ts | awk -F: '{s+=$2} END{print "'"$p"'", s}'
done
# permission 0
# memory 0
```

Both add to `STRICT_PACKAGE_PATHS` in the same commit that sets their budget to 0.

---

## 5. P3 — Wave 3 domain core seams

`provider`, `tool-registry`, `command-runtime` already have 0 budget. P3 adds the **cross-cutting contracts** to all three so Wave 4 (`agent`) can stand on a stable surface.

### P3.1 — Error namespaces (V7 §6.5)

For each of `provider`, `tool-registry`, `command-runtime`, `permission`, `memory`, `storage`, `shell`, `config`:

```ts
// packages/<owner>/contracts/errors.ts
export class ProviderBaseError extends Error {
  readonly code: string
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = this.constructor.name
    this.code = code
  }
}

export class AuthError extends ProviderBaseError {}
export class RateLimitError extends ProviderBaseError {}
export class ContextOverflowError extends ProviderBaseError {}
export class UpstreamError extends ProviderBaseError {}
export class StreamError extends ProviderBaseError {}

export const ProviderError = {
  Base: ProviderBaseError,
  Auth: AuthError,
  RateLimit: RateLimitError,
  ContextOverflow: ContextOverflowError,
  Upstream: UpstreamError,
  Stream: StreamError,
} as const
```

Subtypes follow the §6.5 table verbatim. Hosts use `instanceof ProviderError.RateLimit` (V7 §3.8 forbids string matching).

`agent` exports `UserAbort` as a singleton marker (per §6.5 table, "不是 Error 的子類別"):

```ts
// packages/agent/contracts/errors.ts
export const UserAbort: unique symbol = Symbol('UserAbort')
export type UserAbortReason = typeof UserAbort | TimeoutAbort | SystemAbort
```

`scripts/verify-error-namespaces.ts` switches from `pending` to active and asserts the export shape exists.

### P3.2 — Testing seams (V7 §9.11)

For each package, add `testing/` directory with in-memory fakes. Example:

```ts
// packages/provider/testing/index.ts
import type { ProviderAdapter, ProviderQueryArgs, ProviderEvent } from '../src/contracts.js'

export class InMemoryProvider implements ProviderAdapter {
  readonly id = 'in-memory'
  private queue: ProviderEvent[] = []
  enqueue(event: ProviderEvent) { this.queue.push(event) }
  async *queryStream(_args: ProviderQueryArgs, signal: AbortSignal) {
    for (const event of this.queue) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      yield event
    }
  }
  // ... rest of ProviderAdapter
}

export class ErroringProvider implements ProviderAdapter { /* throws */ }
export class SlowProvider implements ProviderAdapter { /* configurable delay */ }
```

Each `package.json`:

```jsonc
"exports": {
  ".": "./src/index.ts",
  "./contracts": "./src/contracts.ts",
  "./testing": "./testing/index.ts"
}
```

Constraint: `testing/*.ts` must import only from `../src/contracts.js` — never from `../src/internal/`. The verifier enforces this with a literal `rg` check.

`scripts/verify-testing-seams.ts` switches from `pending` to active.

### P3.3 — AbortSignal propagation (V7 §3.7)

Audit each candidate package for functions matching the regex `query|stream|exec|run|connect|fetch|read|write|prefetch|discover|executeTool` that lack `signal: AbortSignal`. For each:

1. Add `signal: AbortSignal` as the last positional or as a `{ signal }` option.
2. Plumb through to all sub-calls (provider stream, MCP transport, fs.* if it has an equivalent — `node:fs/promises` accepts `{ signal }`, `node:child_process.spawn` honors `signal`).
3. At each `await` / generator yield, check `signal.aborted` and throw `DOMException('Aborted', 'AbortError')`.

`scripts/verify-abort-signal.ts` switches from `pending` to active.

### P3 exit gate

```
verify-error-namespaces:  green for provider/tool-registry/command-runtime/permission/memory/storage/shell/config
verify-testing-seams:     green for provider/tool-registry/command-runtime/permission/memory/storage/output/local-observability/config
verify-abort-signal:      green for provider/tool-registry/command-runtime/mcp/permission/storage/shell
```

---

## 6. P4 — Wave 4 agent

`agent` is the integration point of every Wave 1-3 contract. The §10.4 rule "agent and provider may NEVER be migrated in parallel" is automatically respected here because P4 follows P3.

### P4.1 — Drain agent budget 149 → 0

Highest-ref files first (so the AgentLoop refactor happens against a stable substrate):

| File | Refs |
|---|---|
| `packages/agent/query.ts` | 49 |
| `packages/agent/QueryEngine.ts` | 49 |
| `packages/agent/internal/stopHooksCore.ts` | 20 |
| `packages/agent/internal/fileHistoryCore.ts` | 10 |
| `packages/agent/internal/cronTasksLockCore.ts` | 8 |
| `packages/agent/internal/cronTasksCore.ts` | 7 |
| `packages/agent/internal/cronSchedulerCore.ts` | 3 |
| `packages/agent/__tests__/productionWiring.test.ts` | 2 |
| `packages/agent/hooks/index.ts` | 1 |

Strategy: leaves first (small files), then `stopHooksCore`, then `fileHistoryCore`, then the cron set, then finally the two big ones (`query.ts` + `QueryEngine.ts`) where the whole AgentLoop+turn orchestration finally lives in `packages/agent/turn/` per V7 §8.2.

For each `app-compat` import: see if the symbol belongs in agent or in another owner. Examples likely to come up:

| Symbol | Real owner | Action |
|---|---|---|
| `CanUseToolFn` from `app-compat/hooks/useCanUseTool.js` | `permission/contracts` | `import type { CanUseToolFn } from '@claude-code/permission/contracts'` (and move the type definition there) |
| `FallbackTriggeredError` from `app-compat/services/api/withRetry.js` | `provider/contracts/errors` | Move to `provider`, agent imports from `@claude-code/provider/contracts` |
| `autoCompact` from `app-compat/services/compact/autoCompact.js` | `agent/compaction` | Move into `packages/agent/compaction/` (already partially there) |

### P4.2 — AgentEvent reshape (V7 §9.10)

Replace `packages/agent/types/events.ts` with the V7 §9.10 spec:

```ts
import { v7 as uuidv7 } from 'uuid'
import type { AssistantMessage } from './messages.js'

export type TurnEndReason = 'complete' | 'abort' | 'error'

export type AgentEvent =
  | { kind: 'turn-start';          turnId: string; ts: number }
  | { kind: 'assistant-token';     turnId: string; ts: number; text: string }
  | { kind: 'assistant-message';   turnId: string; ts: number; message: AssistantMessage }
  | { kind: 'tool-call';           turnId: string; ts: number; tool: string; input: unknown }
  | { kind: 'tool-result';         turnId: string; ts: number; tool: string; result: unknown }
  | { kind: 'tool-progress';       turnId: string; ts: number; tool: string; progress: unknown }
  | { kind: 'permission-ask';      turnId: string; ts: number; tool: string; context: unknown }
  | { kind: 'permission-decision'; turnId: string; ts: number; decision: 'allow' | 'deny' | 'ask' }
  | { kind: 'error';               turnId: string; ts: number; error: TypedError }
  | { kind: 'turn-end';            turnId: string; ts: number; reason: TurnEndReason }

export const mintTurnId = (): string => uuidv7()
```

The current `PermissionRequestEvent` has a `resolve: (result) => void` callback. Per V7 §9.10 ("agent publishes once; subscribers independently filter") this is replaced by:

- Agent emits `permission-ask` and **suspends the turn**.
- Permission subsystem (or its host adapter) consumes the event, makes a decision, and **publishes** `permission-decision` back into the same event stream via a host-provided control channel.
- Agent resumes when it receives the matching `permission-decision`.

This is a non-trivial reshape — see P4.4.

### P4.3 — Agent error namespace + testing seam + AbortSignal

- `packages/agent/contracts/errors.ts` exports `UserAbort` symbol + `TimeoutAbort` + `SystemAbort` types.
- `packages/agent/testing/index.ts` exports `RecordingAgent` (captures every event), `ScriptedAgent` (replays a fixed event sequence), and `AbortableAgent` (cooperates with cancellation tests).
- Every `runTurn` / `submit` / `loop` API in `packages/agent/turn/` accepts `signal: AbortSignal`.

### P4.4 — Permission control channel

The permission flow needs a way for the host to inject decisions back into the event stream. V7 §9.10 calls this an `EventBus`:

```ts
// packages/agent/contracts/event-bus.ts
type EventBus = {
  subscribe(target: OutputTarget | ObservabilitySink | StorageSink): Unsubscribe
  publish(event: AgentEvent): void
}
```

Agent owns the bus. The permission subsystem subscribes to `permission-ask` events and publishes `permission-decision` events. The agent loop suspends on `permission-ask` until a matching `permission-decision` arrives.

### P4 exit gate

```
packages/agent app-compat refs                       0
verify-event-spine                                   green
verify-error-namespaces (agent)                      green
verify-testing-seams (agent)                         green
verify-abort-signal (agent)                          green
fork/resume/replay regression test from event journal green
```

The fork/resume/replay test is new — V7 §9.10 says the unified event log must support it, so a test that drives a session, persists the event journal, and rebuilds session state from the journal must pass before P4 closes.

---

## 7. P5 — Wave 5 integrations

Strict serial (WIP=1). Each integration is a complete commit chain that:

1. Moves `src/<integration>/` → `packages/<integration>/`.
2. Replaces `src/<integration>/<file>.ts` with re-export facades.
3. Adds the package to `verify-runtime-boundaries.ts` `STRICT_PACKAGE_PATHS`.
4. Wires the integration into `packages/app-host` per §8.1 Feature Flag Binding Policy: app-host reads the feature flag at composition time and either injects the integration runtime or injects nothing — the integration package itself does not call `feature(...)` to gate its own existence.

### P5.1 — `voice` (V7 §8.20)

Source: `src/voice/`, `src/hooks/useVoice.ts`, `src/services/voiceStreamSTT.ts`.

Internal structure:

```
packages/voice/
  src/
    contracts.ts        (VoiceRuntime, VoiceConfig, RecordingState)
    audio/              (audio capture interface, dispatcher to platform backend)
    stt/                (Anthropic STT WebSocket client)
    state/              (recording state machine)
    gate.ts             (3-layer gate: feature flag + GrowthBook + OAuth)
  testing/              (NullVoice, RecordingVoice)
```

Depends on `provider` (shared OAuth), `config`, `local-observability`. Must NOT depend on `repl` internals.

### P5.2 — `bridge` (V7 §8.21)

Source: `src/bridge/` (~30 files).

Already a coherent subdirectory; mostly a `git mv` plus path updates. The bridge already has its own internal layering (`bridgeApi`, `bridgeMessaging`, `bridgePermissionCallbacks`, `replBridgeTransport`) that maps cleanly to:

```
packages/bridge/
  src/
    contracts.ts
    api/
    auth/         (jwtUtils.ts, ...)
    transport/
    permissions/
    sessions/
    runtime/
  testing/
```

Depends on `server`, `headless-sdk`, `local-observability`.

### P5.3 — `daemon` (V7 §8.22)

Source: `src/daemon/`.

Smallest of the three; mostly a relocation. Depends on `app-host`, `local-observability`.

### P5.4 — `mcp` & `swarm` finalization

`packages/mcp-runtime` already has 0 budget but lacks error namespace + testing seam. Add both. Same for `packages/swarm`.

### P5 exit gate

```
packages/voice          STRICT, 0 src/* refs, 0 app-compat refs
packages/bridge         STRICT, 0 src/* refs, 0 app-compat refs
packages/daemon         STRICT, 0 src/* refs, 0 app-compat refs
packages/mcp-runtime    error namespace + testing seam present
packages/swarm          error namespace + testing seam present
src/voice/              all files are 1-line re-export facades
src/bridge/             all files are 1-line re-export facades
src/daemon/             all files are 1-line re-export facades
```

---

## 8. P6 — Wave 6 hosts

### P6.1 — `repl` (V7 §8.24)

Source: `src/screens/REPL.tsx` (already 19L facade), `src/components/`, `src/hooks/`, `src/PromptInput/` if present.

**Critical:** §8.24 splits `src/components/` into 5 owners. The plan must respect that decomposition rather than dumping all 170+ components into `packages/repl/components/`.

| Components subdir / pattern | Final owner |
|---|---|
| `PromptInput/`, `Messages.tsx`, `MessageRow.tsx`, dialog launchers, screens, App.tsx | `packages/repl/components/` |
| `permissions/*` (permission dialogs) | `packages/permission/prompts/` |
| Tool-specific render components (e.g. BashTool output display) | `packages/tool-registry/render/` |
| `design-system/` (Dialog, FuzzyPicker, ProgressBar, ThemeProvider — pure primitives) | `packages/@ant/ink/` |

The decomposition order (smallest blast radius first):

1. `design-system/` → `@ant/ink` (pure primitives, no domain coupling)
2. `permissions/` → `permission/prompts`
3. tool render components → `tool-registry/render`
4. Everything left → `repl/components`

### P6.2 — `headless-sdk` (V7 §8.25)

Source: `src/cli/headless/*` (currently inside `packages/cli/src/headless/`), `src/remote/sdkMessageAdapter.ts`, `src/remote/RemoteSessionManager.ts`.

Internal structure per §8.25:

```
packages/headless-sdk/
  src/
    contracts.ts
    session/      (create/resume/fork)
    streaming/    (event stream adapter, partial message handling)
    control/      (permission/control requests, MCP server injection)
    compat/       (SDK message adapters)
  testing/        (HeadlessSession with scripted events)
```

Depends on `app-host`, `output`, `storage`, optional `server` for direct-connect.

### P6 exit gate

```
packages/repl           STRICT, 0 src/* refs
packages/headless-sdk   STRICT, 0 src/* refs
src/components/         dissolved into 4 owners
src/cli/headless/       1-line re-export facades or deleted
```

---

## 9. P7 — Final hardening

### P7.1 — Dissolve `AppStateStore` (V7 §7.2)

Per §7.2, `AppState` decomposes into three:

1. Host Session Store — moves to `packages/app-host/src/session/` (focused task, connection state, dialog visibility, footer)
2. Domain Runtime Handles — moves to `packages/app-host/src/composition/` (refs to agent/mcp/permission/memory runtimes)
3. Pure UI Local State — stays in component-local `useState` calls; nothing global

`src/state/AppStateStore.ts` becomes a 1-line facade re-exporting from `app-host`. Subsystem-specific `AppState.<field>` accesses across the codebase get rewritten one by one to read from the proper owner.

### P7.2 — Delete `@cc-app/*` and `@claude-code/app-compat/*` tsconfig path aliases

Once **every** package has 0 in `TRANSITION_APP_COMPAT_REF_BUDGET`:

```jsonc
// tsconfig.json — remove these
"@cc-app/*": ["./src/*"],
"@claude-code/app-compat/*": ["./src/*"]
```

`scripts/verify-runtime-boundaries.ts`: empty out the transition budget map; turn on STRICT mode for all PACKAGE_PATHS.

The 10 remaining `@cc-app/*` references in `packages/@ant/ink/` and `packages/@ant/computer-use-swift/` (intl utils, Cursor, stringUtils, win32 window enum/capture) must also resolve before this step. Each of those references is to a small utility — the fix is to either move the utility into the `@ant/ink` or `@ant/computer-use-swift` package, or move it to `@claude-code/local-observability` if it's general.

### P7.3 — CI integration

`.github/workflows/ci.yml` (or equivalent): add a required check that runs `bun run doctor:arch` and fails the PR on any non-zero exit.

### P7 exit gate (V7 §14 Definition of Done)

| V7 § | Check | Verification |
|---|---|---|
| §14.1 | All Core Domain / Platform Runtime owner packages have 0 `@cc-app/*` and 0 `src/*` imports | `verify-runtime-boundaries` strict mode for all packages, empty budget map |
| §14.1 | `app-host`, `storage`, `output`, `local-observability` are real packages with public surface | already true |
| §14.1 | `main.tsx` ≤200, `print.ts` ≤50, `REPL.tsx` ≤30 | already true (64/9/19) |
| §14.1 | Each owner has `/testing` subpath | `verify-testing-seams` green |
| §14.2 | `src/query.ts` / `src/QueryEngine.ts` / `src/tools.ts` / `src/commands.ts` are facades | already true |
| §14.2 | `src/services/mcp/client.ts` is thin compat | enforced once `mcp-runtime` STRICT |
| §14.2 | `AppState` is not the terminal owner | enforced by P7.1 |
| §14.3 | CLI / SDK / REPL / direct-connect external behavior unchanged | smoke matrix in CI |
| §14.4 | `bun run doctor:arch` all green; CI blocks on it | enforced by P7.3 |
| §14.4 | Each §12 Non-Negotiable maps to a verifier (or §13.1 unautomated exception) | covered by P0.4 + P3 + P4 verifiers |
| §14.5 | Every `AsyncIterable<*>` API takes `signal: AbortSignal` | `verify-abort-signal` green for all watched packages |
| §14.5 | Ctrl-C → root abort scope cleans up in ≤500ms | new test `tests/integration/abort-cleanup.test.ts` |
| §14.5 | Host `error.message` string-match count = 0 | new verifier `verify-no-string-error-match.ts` (`rg "\.message\.includes\("` in host packages = 0) |
| §14.5 | `AgentEvent` is the only agent→host event type | `verify-event-spine` green; manual review of `packages/repl/` event consumers |
| §14.5 | Fork/resume/replay test from event journal succeeds | new test `tests/integration/event-journal-replay.test.ts` |
| §14.6 | Architecture is self-explaining from V7.md + doctor:arch --list | unverifiable; passes by inspection at end |

---

## 10. Risk & rollback policy

### 10.1 Per-commit verification suite

Run after **every** commit, no exceptions:

```bash
bun run doctor:arch \
  && bun test \
  && bun run build \
  && echo "ping" | bun run src/entrypoints/cli.tsx -p > /dev/null
```

If any step fails:

```bash
git revert HEAD
git push origin main
```

Then file the failure as a follow-up task in `TaskCreate` with the exact failing command output. **Do not fix-forward** — Ralph loop iterations have no time pressure justification for keeping broken commits on `main`.

### 10.2 Doctor budget monotonicity

For each commit, doctor:arch budget numbers may **only decrease or hold**, never increase. The plan adds a tripwire: a CI step that compares the current budget map against `.baseline-doctor.json` and fails if any entry grew. This catches accidental "I added one more app-compat import to fix a bug" regressions.

### 10.3 WIP=1

Only one in-progress task at a time per V7 §10.4 WIP limit. Even when running multi-iteration Ralph loops, the iteration is required to:

1. Read `TaskList`.
2. Pick the lowest-id task in `pending` with no `blockedBy`.
3. Mark it `in_progress`.
4. Work to completion (or revert).
5. Mark it `completed` (or back to `pending` with a comment).
6. Stop and let the next iteration pick.

### 10.4 Five non-iterable conditions

The Ralph loop **must stop and surface to user** if:

1. doctor:arch fails after a `git revert` (revert didn't restore the baseline).
2. `bun test` reports failures that exist on `main` and are not pre-existing locale failures.
3. The current task requires merging across owners that aren't yet drained (out-of-order wave attempt).
4. A V7 rule conflict surfaces (e.g. moving a symbol into `agent` would force a Core-Domain → Integration dependency).
5. The 14-day exemption expiry from V7 §13.2 starts being hit by real exemptions — surfaces to user before more accumulate.

---

## 11. Iteration cadence

Ralph loop iteration shape:

1. Read `TEAM_PLAN/v7-refactor-plan.md` (this file) and `bun run doctor:arch --json` to find current state.
2. `TaskList` to find next pending task with empty `blockedBy`.
3. `TaskUpdate` → `in_progress`.
4. Execute the task — strictly one section, strictly per the playbook above.
5. Run verification suite.
6. Commit (or revert and re-task) with `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>` footer.
7. `TaskUpdate` → `completed`.
8. Stop iteration.

Estimated total iterations:
- P0: 5 commits → ~5 iterations
- P1 (config 116 → 0): ~12 iterations
- P2 (permission 88 + memory 84 → 0): ~18 iterations
- P3 (3 cross-cutting passes × 3 packages): ~9 iterations
- P4 (agent 149 → 0 + AgentEvent reshape + control channel): ~25 iterations
- P5 (3 integrations + 2 finalizations): ~15 iterations
- P6 (2 host packages + components decomp): ~20 iterations
- P7 (AppState dissolve + tsconfig purge + CI): ~10 iterations
- **Total: ~114 iterations** of the 200 budget

Buffer: ~86 iterations for unexpected refactors, test fixes, or scope corrections discovered along the way.

---

## 12. Open questions surfaced by this plan

- **§9.10 Permission control channel design** — V7 says "subscribers independently filter" but does not specify how the host injects a decision back into a single-producer event stream. P4.4 picks an EventBus model that lets multiple publishers contribute to one stream; this is a one-line departure from the §9.10 wording ("Agent is the unique event producer") and should be reviewed before P4 starts.
- **§8.24 design-system migration scope** — `packages/@ant/ink` is a fork of Ink (V7 §19.1 acknowledged debt). Adding the design-system primitives may bloat the fork further. Alternative: a new `packages/design-system` peer of `@ant/ink`. Decision needs user input before P6.1 step 1.
- **§14.5 Ctrl-C cleanup timing** — "≤500ms" is V7's cleanup budget. The current REPL likely does not measure this. P7 adds a regression test, but it needs a baseline measurement first (likely 200-300ms based on current MCP transport teardown time).
- **§19.1 `@ant/ink` ↔ React Compiler** — None of the V7 plan touches the decompiled `_c()` memoization noise per §19.3. This stays as acknowledged debt.

---

*Generated 2026-04-12 against doctor:arch baseline 22/22, app-compat budgets total 437.*
