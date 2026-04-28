# Plugin Stop hooks silently no-op'd post-V7 — root cause + fix

## Symptom

ralph-loop's Stop hook never fires in REPL. Plugin loads, hooks parsed,
"Registered 3 hooks from 27 plugins" appears in startup logs — but the
hook command never spawns. Same for any other plugin Stop hook.

## Root cause: unconnected setter slots in `_deps.ts`

V7 moved plugin loading out of `src/utils/plugins/` into
`packages/config/plugin/`. The new package owns no real state of its own;
it talks to host services through a setter-injection pattern in
`packages/config/plugin/_deps.ts`. Each external dependency is declared
as a slot:

```ts
const [_getRegisteredHooks_, setGetRegisteredHooksFn_] =
  makeSetter((): unknown[] => [])
export function getRegisteredHooks(): unknown[] {
  return _getRegisteredHooks_()()
}
export const setGetRegisteredHooksFn = setGetRegisteredHooksFn_
```

The host (`packages/app-host/src/runtime/installPluginBindings.ts`) is
supposed to call `setGetRegisteredHooksFn(realImpl)` at startup so the
slot resolves to the real STATE-backed implementation. **For three slots
related to hook dispatch, this wire was never written**:

- `setGetRegisteredHooksFn` — reads plugin hooks from STATE
- `setRegisterHookCallbacksFn` — writes plugin hooks into STATE
- `setClearRegisteredPluginHooksFn` — clears STATE during reload

Result:
- `loadPluginHooks()` calls `registerHookCallbacks(hooks)` → no-op default
- `packages/agent/hooks.ts` reads via app-host's real `getRegisteredHooks()`
  → returns `null`
- `hasHookForEvent('Stop')` returns `false` → `executeStopHooks` early-returns
- ralph-loop's hook silently never spawns

The two halves never spoke to each other. Read and write went to different
storages.

A second slot has the same disease: `setGetSecureStorageFn`. Without it,
`loadPluginOptions()` does `getSecureStorage().read()` on `null` and
crashes inside every hook spawn with "null is not an object (evaluating
storage.read())". This is what manifested as the SessionStart hook
errors after the first wire fix.

## Why bisect to a commit doesn't help

Both slots have been disconnected since `efe458cf` ("plugin package
scaffold + first 6 leaf facades") — the commit that introduced the
`_deps.ts` pattern. Every Stop hook from every plugin has been broken
since that day. `git log -S setRegisterHookCallbacksFn` returns one
result: the line that declares the export. Nobody ever called it.

## Fix

Three lines in `packages/app-host/src/runtime/installPluginBindings.ts`:

```ts
setGetRegisteredHooksFn(() => getRegisteredHooks() as never)
setRegisterHookCallbacksFn(hooks => registerHookCallbacks(hooks as never))
setClearRegisteredPluginHooksFn(() => clearRegisteredPluginHooks())
```

Plus one for secureStorage (lazy require to avoid a startup-order edge):

```ts
setGetSecureStorageFn(() => {
  const mod = require('@claude-code/storage/secureStorage.js')
  return mod.getSecureStorage?.() ?? null
})
```

That's the entire fix.

## Secondary fix in HookDepImpl.onStop

While diagnosing, found a separate bug on the headless `-p` path:
`packages/agent/createDeps.ts` had `await handleStopHooks(...)` on what
is actually an `async function*`. `await` on the call expression
returns the generator object without iterating; the body never runs,
the StopHookResult on the final iterator value is never read.

Fixed in the same change: drain the generator manually, take the
`done: true` value as the result, pass the full 8-arg signature
(systemPrompt / userContext / systemContext / querySource were missing
from the previous 2-arg call). REPL was unaffected because it goes
through `query.ts`'s `yield* handleStopHooks(...)` which iterates
correctly; only the `-p` / SDK path needed this.

## Verified

REPL test: `/ralph-loop:ralph-loop "..." --max-iterations 2` now runs
through both iterations, fires Stop hook on each, prints
`🔄 Ralph iteration 2` between turns and stops cleanly at max.
