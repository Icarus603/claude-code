# V7 Complete Refactor — Shared Team Plan

## Project Root
`/Users/liuzetfung/code/playground/claude-code`

## Current State (session start)
- `bun run doctor:arch` → 20/20 passing (FLOOR — never regress below this)
- `bun test` → 2269 pass / 5 pre-existing locale failures (those 5 are NOT regressions)
- `src/cli/print.ts` → 5,263 lines, 66 root `src/*` imports
- `src/main.tsx` → 6,604 lines, untouched
- Branch: `main`, direct pushes authorized

## Verification Suite (run after EVERY commit)
```bash
bun run doctor:arch && bun test && bun run build && echo "hello" | bun run src/entrypoints/cli.tsx -p
```
If ANY step fails: `git revert HEAD && git push origin main` then report to lead.

## Rollback Policy
Each cut = one commit. On failure: revert, push, report. Never fix-forward under time pressure.

## Import Rules for Package Files
- `packages/cli` → NOT in STRICT_PACKAGE_PATHS → root `src/` relative imports OK
- `packages/app-host` → IN STRICT_PACKAGE_PATHS → NO root `src/` imports (use `@claude-code/*` only)
- `packages/mcp-runtime` → NOT in STRICT_PACKAGE_PATHS → root relative imports OK
- ALL formal packages: never `from '@cc-app/'`
- Check `scripts/verify-runtime-boundaries.ts` for current STRICT list

## Pattern References (REUSE, do not reinvent)
- Host bindings: `packages/cli/src/contracts.ts` + `packages/cli/src/transport.ts` + `src/runtime/installCliBindings.ts`
- Dependency injection: `packages/cli/src/headless/handleOrphanedPermissionResponse.ts`
- Direct pure-function move: `packages/mcp-runtime/src/config.ts` (toScopedConfig)
- Isolated constant (TDZ break): `src/tools/BashTool/toolName.ts`
- Thin wrapper after extraction: `src/cli/print.ts` lines 5233–5262 (handleMcpSetServers/reconcileMcpServers)

## Shared Naming Conventions
- New package files: `packages/<pkg>/src/<subdir>/<kebab-case>.ts`
- Testing subpaths: `packages/<pkg>/testing/index.ts`
- Error classes: `class <Domain>Error extends Error { readonly code: string }`
- AgentEvent discriminant: always `type`; required fields: `turnId: string`, `ts: number`
- Commit format: `refactor(v7): <description>` with Co-Authored-By footer

## Phase Overview

### Phase 1: AgentEvent Contract [CURRENT]
Create `packages/agent/src/events.ts` (AgentEvent union) and `packages/agent/src/tee.ts` (async tee).
Done when: `AgentEvent` + `tee` exported from `@claude-code/agent`, build passes.

### Phase 2: print.ts Helper Extraction (4 sequential cuts)
Extract 7 helper functions from print.ts to new packages/cli files.
Done when: print.ts ≤1,600L (runHeadless + runHeadlessStreaming still present).

### Phase 3: print.ts Core Extraction (2 sequential cuts)
Extract runHeadless (520L) then runHeadlessStreaming (3,179L) — structural move only, NO event spine yet.
Done when: print.ts ≤300L, pipe smoke passes.

### Phase 4: main.tsx Decomposition (5 sequential cuts)
Decompose main.tsx from 6,604L to <200L.
Done when: main.tsx ≤200L, all verifications pass.

### Phase 5: Event Spine Wiring (1 cut)
Transform runHeadlessStreaming to `async function* ... AsyncIterable<AgentEvent>`.
Wire tee/fan-out in runHeadless. Existing behavior preserved via local subscribers.
Done when: runHeadlessStreaming yields AgentEvents, pipe smoke passes.

### Phase 6: Cross-Cutting Contracts (3 parallel cuts)
- T6-1: Error taxonomy (8 packages, typed error classes)
- T6-2: Testing seams (9 packages, testing/ subpaths)
- T6-3: AbortSignal propagation (≥5 major call sites)
Done when: 9 testing subpaths, 8 error namespaces, ≥5 AbortSignal pass-throughs.

### Phase 7: Hardening (3 cuts)
- AppStateStore → compat facade
- 3 new verifier scripts (event-spine, testing-seams, error-taxonomy)
- Integration tests + smoke
Done when: doctor:arch ≥23/23, bun test green.

## print.ts Function Map (current line numbers, as of phase start)
| Function | Lines | Size | Phase |
|----------|-------|------|-------|
| joinPromptValues | 433–447 | ~15L | Phase 2 cut-A |
| canBatchWith | 448–459 | ~12L | Phase 2 cut-A |
| runHeadless | 460–980 | 520L | Phase 3 cut-1 |
| runHeadlessStreaming | 981–4160 | 3,179L | Phase 3 cut-2 |
| createCanUseToolWithPermissionPrompt | 4161–4278 | 117L | Phase 2 cut-B |
| getCanUseToolFn | 4279–4347 | 68L | Phase 2 cut-B |
| handleInitializeRequest | 4348–4531 | 183L | Phase 2 cut-C |
| handleSetPermissionMode | 4582–4675 | 93L | Phase 2 cut-C |
| handleChannelEnable | 4676–4799 | 123L | Phase 2 cut-C |
| reregisterChannelHandlerAfterReconnect | 4800–4854 | 54L | Phase 2 cut-C |
| removeInterruptedMessage | ~4889 | small | Phase 2 cut-D |
| loadInitialMessages | 4907–5212 | 305L | Phase 2 cut-D |

## main.tsx Section Map
| Section | Lines | Target | Phase |
|---------|-------|--------|-------|
| getTeammateModeSnapshot | 161–506 | packages/app-host/src/bootstrap/utils.ts | Phase 4 cut-A |
| isBeingDebugged + helpers | 525–872 | packages/app-host/src/bootstrap/utils.ts | Phase 4 cut-A |
| createSortedHelpConfig | 974–2356 | packages/cli/src/entry/commander.ts | Phase 4 cut-B |
| run() .action() handler | ~1461–5470 | packages/app-host/src/entrypoints/mode-dispatch.ts | Phase 4 cut-E |
| .command('mcp') batch | 5471–5800 | thin wiring to packages/mcp-runtime | Phase 4 cut-C |
| .command('auth') etc. batch | 5800–6464 | thin wiring to existing packages | Phase 4 cut-D |

## AgentEvent Type (Phase 1 output — reference for Phase 5)
```ts
export type AgentEvent =
  | { type: 'token'; turnId: string; ts: number; delta: string }
  | { type: 'message'; turnId: string; ts: number; message: unknown }
  | { type: 'tool-call'; turnId: string; ts: number; toolName: string; input: unknown }
  | { type: 'tool-result'; turnId: string; ts: number; toolName: string; result: unknown }
  | { type: 'tool-progress'; turnId: string; ts: number; toolName: string; progress: string }
  | { type: 'permission-ask'; turnId: string; ts: number; toolName: string }
  | { type: 'permission-decision'; turnId: string; ts: number; toolName: string; granted: boolean }
  | { type: 'error'; turnId: string; ts: number; error: unknown }
  | { type: 'turn-start'; turnId: string; ts: number }
  | { type: 'turn-end'; turnId: string; ts: number }
```

## Testing Seam Packages (Phase 6 T6-2 output)
1. `@claude-code/provider/testing` → InMemoryProvider, ErroringProvider
2. `@claude-code/mcp-runtime/testing` → InMemoryMcpRuntime
3. `@claude-code/storage/testing` → MemoryStorageBackend
4. `@claude-code/output/testing` → CapturingOutputTarget
5. `@claude-code/permission/testing` → AllowAllPermission, DenyAllPermission
6. `@claude-code/tool-registry/testing` → StubRegistry
7. `@claude-code/command-registry/testing` → StubCommandRuntime
8. `@claude-code/local-observability/testing` → NullObservability, RecordingObservability
9. `@claude-code/config/testing` → InMemoryConfig

## What Cannot Be Verified Automatically
- Interactive REPL input (requires real TTY)
- Voice Mode, Bridge, Daemon, remote sessions
- Computer Use screenshot/click paths
Flag these as "not verified — please smoke manually".
