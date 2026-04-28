# The silent-failure bug class — why "doctor green" doesn't mean "code works"

**Status**: Active. Discovered 2026-04-28. Two of the surfaced
instances are fixed (commits 8858c83d, f317c7d2). 48+ siblings remain
latent. **This document is required reading for anyone extending the
V7 doctor or claiming a refactor is "done".**

## TL;DR

- `doctor:arch` has 52 verifiers, all of them static. 0 verify that
  abstractions actually connect at runtime.
- The V7 refactor introduced a `_deps.ts` setter-injection pattern
  with 147 setter slots across 5 packages. **48 of those slots have
  consumers but were never wired by any host bootstrap.** When the
  consumer fires, it hits the safe default (returns `null`, `[]`,
  `{}`, or no-op fn) and silently does nothing.
- Plugin Stop hooks (e.g. ralph-loop) are one of the 48. They have
  been broken since V7 day one (commit `8b739e17`). Nobody noticed
  for ~200 commits because they don't appear in any test, smoke or
  otherwise.
- Bug class > bug. Fixing only ralph-loop would have left 47 more
  ticking. Treat any silent-no-op finding as the tip of an iceberg.

## How V7 broke this

V7 split `src/utils/plugins/` and friends into
`packages/config/plugin/`. The new package can't directly import
implementations that live elsewhere (would create cycles or violate
package boundaries). The chosen escape hatch was the setter-injection
pattern in `packages/config/plugin/_deps.ts`:

```ts
const [_get, setXxxFn_] = makeSetter(safeDefault)
export function getXxx() { return _get()() }
export const setXxxFn = setXxxFn_
```

Reader side imports `getXxx` and uses it. Writer side (host bootstrap,
typically `packages/app-host/src/runtime/install*Bindings.ts`) was
supposed to call `setXxxFn(realImpl)` at startup. **For 48 slots, the
writer side was never written.** `safeDefault` fires forever.

The pattern wasn't intentionally bad. It was meant as a temporary
shim during the migration. It ossified into permanent placeholder
because:

1. doctor:arch all green ⇒ "V7 refactor complete" ⇒ no follow-up
2. Reviewers can't track 50 wires per PR by eye
3. The slots compile; the typecheck passes; the lint passes; the
   safe default doesn't throw. There is no surface signal of breakage.

## How it surfaces in practice

Three real symptoms observed:

1. **ralph-loop plugin's Stop hook never fires.** User had to run
   ralph-loop in a real REPL session to notice. Trace showed
   `hasHookForEvent('Stop')` returning false because
   `getRegisteredHooks()` (in `_deps.ts`) returned the default empty
   object — `loadPluginHooks()` writes via the unwired
   `registerHookCallbacks` so plugin hooks landed in dead storage,
   while `agent/hooks.ts` reads from `app-host`'s real STATE.
   Read-side and write-side spoke to different storages.

2. **SessionStart hooks throw `null is not an object`.** Same class:
   `loadPluginOptions()` calls `getSecureStorage().read()`, but
   `getSecureStorage`'s setter slot was never wired, so default
   returns `null`, and `.read()` throws.

3. **Headless `-p` mode never blocks for plugin Stop hooks.** Same
   class but a different mechanism: `HookDepImpl.onStop` in
   `packages/agent/createDeps.ts` was `await handleStopHooks(...)` on
   an `async function*`. `await` on a generator function call returns
   the generator object without iterating; body never runs; result is
   undefined; AgentLoop never sees `preventContinuation: true`.

The fixes (commit `8858c83d`) addressed only the four wires for the
ralph-loop / SessionStart case. **The other 44 read-only slots are
untouched.** Each is a latent silent failure in some code path nobody
has stress-tested yet.

## Why doctor:arch missed all of it

The 52 verifiers measure:
- file locations, import paths, package boundaries
- LOC budgets, ratchets
- naming conventions, no-cycles
- export map coverage
- empty folders, anti-patterns

None measure "does this abstraction actually connect at runtime?".
The setter pattern satisfies every static rule perfectly while being
a complete behavioural lie.

## Inventory (as of 2026-04-28, after commit f317c7d2)

```
Total setter slots across packages/**/_deps.ts:    138 (was 147)
LIVE       (consumer + producer both connected):    74
READ-ONLY  (consumer wired, producer absent):       48  ← all latent silent failures
WRITE-ONLY (producer wired, consumer absent):       16  ← wasted boilerplate
DEAD       (neither side):                           0  (cleared in f317c7d2)
```

`packages/config/plugin/_deps.ts` is by far the worst offender (47 of
48 read-only slots). `packages/shell/src/_deps.ts` has 1.

## What "doing it right" looks like

### Short term (visible per commit)

Whenever a setter slot is added to any `_deps.ts`, the same PR must
include the wire in `packages/app-host/src/runtime/install*Bindings.ts`.
There is no exception. If the wire can't be written yet, don't add the
slot — write a TODO and a tracking issue, not a placeholder.

### Medium term (verifier-enforced)

`scripts/verify-deps-setters-wired.ts` exists but is not yet in
`doctor:arch` because 48 violations would immediately block. Path to
green:

1. Resolve the 48 read-only slots:
   - **B1** (preferred): inline-import the real implementation directly
     from its V7 owning package, delete the slot. This is what we did
     for `getSecureStorage` etc. in commit `8858c83d`.
   - **B2** (fallback): write the wire in `installPluginBindings.ts`
     pointing to the real implementation in src or another package.
2. Resolve the 16 write-only slots: delete them. They're dead code
   that someone wrote a wire for but no one consumes.
3. Wire `verify-deps-setters-wired` into `scripts/doctor-architecture.ts`.
4. Once green, the verifier permanently prevents this class from
   re-introduction.

### Long term (cultural)

Doctor:arch must grow **behaviour verifiers**, not just structure
verifiers. Candidates:

- `await-generator-misuse` — AST detect `await xxx()` where `xxx` is
  declared `async function*`. Catches the HookDepImpl.onStop bug.
- `silent-fallback-detector` — `try { ... } catch { return [] }` and
  `?? null` as the right-hand side of a critical-path call must carry
  a comment explaining why the fallback is correct. Otherwise treat
  as a smell.
- `optional-chain-on-required-binding` — `getXxxBindings().method?.()`
  where `method` is declared non-optional in the contract is the
  same trap as the setter pattern. Should be a hard error.
- `dual-storage-divergence` — same-name read/write functions across
  packages must converge to the same backing store. The ralph-loop
  bug was a textbook case: `registerHookCallbacks` writes to
  `_deps.ts` placeholder, `getRegisteredHooks` reads from app-host
  STATE.
- `host-bindings-protocol-coverage` — for every protocol declared by
  a plugin or external contract (hooks.json schema, MCP types,
  AgentHostBindings interface), every field must have a sink in the
  dispatch path or be marked deliberately unhandled.

### Operational (smoke tests)

We have 4 integration tests for 200k+ LOC. That is not enough for a
codebase with this many implicit wires. Need at minimum:

- `bun smoke:repl` — spin up REPL, send a prompt, exercise hook chain
- `bun smoke:headless` — pipe a prompt to `-p`, verify result
- `bun smoke:plugin` — install a fake plugin that exercises every
  hook event, assert each fires
- `bun smoke:resume` — start session, write, exit, resume, assert
  transcript intact
- `bun smoke:swarm` — start two teammates, verify mailbox

The ralph-loop bug existed for 200+ commits. A `smoke:plugin` test
would have caught it on commit `8b739e17`.

## What this means for "is the refactor done?"

Reframe: **structure refactor is done; behaviour refactor has not
started**. The first visible bug forced the issue. The second one
will. The third one will. Keep treating each as an isolated bug and
the repo stays riddled forever. Fix the class — not the instance.

## See also

- `docs/refactor/hooks-system-bug.md` — the ralph-loop investigation
- `scripts/verify-deps-setters-wired.ts` — the inventory verifier
  (drafted, not yet in doctor)
- Commits `8858c83d`, `f317c7d2` — partial fixes already landed
- `packages/config/plugin/_deps.ts` — the worst offender
- `packages/app-host/src/runtime/installPluginBindings.ts` — the
  wire that should have included the missing 48
