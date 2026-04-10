# V6 Refactor Execution Tracker (T00-T21)

Date: 2026-04-10

## Progress Summary

- Completed: T00, T01, T02, T03(partial), T04(partial), T08(partial), T09(partial), T10(partial), T19, T21(partial)
- In progress: T05, T07, T11
- Not started / large gap remains: T06, T12, T13, T14, T15, T16, T17, T18, T20

## Task-by-task Status

| ID | Status | Evidence | Gap To Done |
|---|---|---|---|
| T00 | Done | `docs/runtime-baseline.md` refreshed with entrypoint hashes, CLI surface snapshot, structural debt snapshot | Need periodic refresh after major moves |
| T01 | Done (guard mode) | `scripts/verify-runtime-boundaries.ts` strengthened + health wired | Core package refs still budget-based, not 0 yet |
| T02 | Done (guard mode) | `scripts/verify-entry-thin-host.ts` checks owner backflow seams | `main.tsx`/`REPL.tsx`/`print.ts` still huge |
| T03 | Partial | `packages/app-host/src/host.ts`, `src/main.tsx`, `src/runtime/bootstrap.ts` now use interactive/headless host factories | runtime graph handles still thin wrapper, composition depth insufficient |
| T04 | Partial | `packages/app-host/src/packageHostSetup.ts` created; installer ownership now moves through root bootstrap/runtime seams instead of package defaults | legacy compat still present in root |
| T05 | Partial | `src/main.tsx` now creates `interactiveHost/headlessHost` | `main.tsx` still owns too much orchestration logic |
| T06 | Not done | n/a | `REPL.tsx` still monolith (6142 LOC) |
| T07 | Partial | bootstrap seam enforced, print/headless host guard added, `packages/cli` headless runtime now installs through root CLI bindings and package transport exports are local facades; app-compat refs are 0 | `src/cli/print.ts` still owner-heavy (5600 LOC) |
| T08 | Partial | `packages/command-registry` runtime is now a thin lazy-installed wrapper over root-installed host bindings; app-compat refs are 0 | runtime installer still resolves via root path fallback instead of a final package-owned host bootstrap contract |
| T09 | Partial | `packages/tool-registry` runtime is now a thin wrapper with package-local fallback bindings for tests; app-compat refs are 0 | fallback builtin discovery is still a test-safe minimal host path, not the final canonical owner shape |
| T10 | Partial | canonical APIs exposed: `connectAll/discover/executeTool/prefetchResources` in mcp-runtime | package still carries app-compat-heavy implementation |
| T11 | Partial | provider host setup moved to root composition seam and `packages/provider/src/claudeLegacy.ts` is now a thin host-bound facade; app-compat refs are 0 | Anthropic legacy implementation still lives outside the canonical package-owned end state |
| T12 | Not done | n/a | permission package still heavily app-compat-coupled |
| T13 | Not done | n/a | memory package still heavily app-compat-coupled |
| T14 | Not done | n/a | config package still heavily app-compat-coupled |
| T15 | Not done | n/a | agent package still heavily app-compat-coupled |
| T16 | Not done | n/a | AppState still domain/integration-heavy |
| T17 | Not done | `packages/storage`, `packages/output` exist | main paths still not fully routed through package contracts |
| T18 | Not done | `packages/local-observability` exists | old telemetry/event owners not fully converged |
| T19 | Done | `packages/ide|teleport|updater|server` skeletons + verifier script | needs real migrations in next wave |
| T20 | Not done | n/a | facade cleanup incomplete, dual-owner zones remain |
| T21 | Partial | `bun run build`, `bun test`, `bun run health` pass with added owner/compat guards (`agent`, `provider`, `app-state`, `repl`, `headless`, `session-format`) | interactive REPL/headless/remote full smoke matrix still not fully automated |

## Structural Gap Snapshot (Current)

```text
packages/agent app-compat=158
packages/provider app-compat=0
packages/config app-compat=117
packages/permission app-compat=89
packages/memory app-compat=83
packages/cli app-compat=0
packages/tool-registry app-compat=0
packages/command-registry app-compat=0
packages/mcp-runtime app-compat=58
```

Target remains all above = 0.

## Next Refactor Wave (strict closure path)

1. Eliminate the remaining `cli` transport re-export compat bridges and move them into package-owned or root-thin facades.
2. Split `provider/claudeLegacy` into package-owned Anthropic adapter internals and leave root only composition/binding.
3. Decompose `REPL.tsx` and `print.ts` into controller/view-model + transport-only host entry.
4. Decompose `AppStateStore` into host session store + runtime handles.
5. Drive `command-registry` / `tool-registry` from low-budget mode to strict zero mode by removing remaining type/runtime compat shims.
6. Flip `verify-runtime-boundaries` core packages from budget mode to strict zero mode.
