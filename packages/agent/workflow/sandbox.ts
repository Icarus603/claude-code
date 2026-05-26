// Workflow script compiler + vm sandbox.
//
// Port of ant 2.1.150 module AyH (3859.js) + JaH (3860.js). A user-authored
// workflow script is wrapped in an async IIFE, compiled to a `vm.Script`, and
// run inside a hardened `vm` context (see compileWorkflowScript / runtime.ts).
//
// Two hard invariants the sandbox enforces:
//  1. Determinism — Date.now() / new Date() / Math.random() throw. The resume
//     journal (journal.ts) replays cached agent() results by (prompt, opts)
//     hash; non-determinism in the script body would desync the replay.
//  2. Isolation — builtin prototypes are frozen (SES-style) and prototype
//     escape hatches are stripped, so a script can't reach back into the host.
//
// The script body has NO filesystem or Node API access; the only capabilities
// are the hooks injected into the context (agent/parallel/pipeline/phase/log/
// workflow + args/budget) — see runtime.ts.

import vm from 'node:vm'

// ant 3859 yw3 / hw3 — the messages thrown by the determinism shim.
const NOW_ERR =
  'Date.now() / new Date() are unavailable in workflow scripts (breaks resume). Stamp results after the workflow returns, or pass timestamps via args.'
const RANDOM_ERR =
  'Math.random() is unavailable in workflow scripts (breaks resume). For N independent samples, include the index in the agent label or prompt.'

// ant 3859 lD6 — sync execution timeout for runInContext. The script body is
// async (awaits agent() calls), so this only caps the SYNCHRONOUS portion that
// runs before the first await — a runaway synchronous loop in the script.
export const WORKFLOW_SYNC_TIMEOUT_MS = 30_000

/**
 * ant 3859 tN — strip an object's prototype chain and the constructor/prototype
 * back-references, so a value handed to the sandbox can't be used to climb back
 * to host intrinsics (e.g. `hook.constructor.constructor('return process')()`).
 * Applied to every hook function and the budget object before they enter the
 * vm context.
 */
export function stripPrototype<T extends object>(obj: T): T {
  Object.setPrototypeOf(obj, null)
  // biome-ignore lint/performance/noDelete: intentional — removing the escape
  // hatches is the whole point; defineProperty(undefined) wouldn't drop them.
  delete (obj as { constructor?: unknown }).constructor
  delete (obj as { prototype?: unknown }).prototype
  return obj
}

// ant 3860 Ew3 — determinism shim. Run inside the fresh context BEFORE the
// script. Overwrites Date/Math.random with throwing versions and closes the
// `(new Date(x)).constructor` backdoor, then freezes RealDate so it can't be
// undone from script code.
const DETERMINISM_SHIM = `(() => {
  const NOW_ERR = ${JSON.stringify(NOW_ERR)};
  const RANDOM_ERR = ${JSON.stringify(RANDOM_ERR)};
  Math.random = function random() { throw new Error(RANDOM_ERR) };
  const RealDate = Date;
  RealDate.now = function now() { throw new Error(NOW_ERR) };
  function ShimDate(...a) {
    if (!new.target) throw new Error(NOW_ERR); // bare Date() → now-string
    if (a.length === 0) throw new Error(NOW_ERR);
    return Reflect.construct(RealDate, a, new.target);
  }
  ShimDate.now = RealDate.now;
  ShimDate.parse = RealDate.parse;
  ShimDate.UTC = RealDate.UTC;
  ShimDate.prototype = RealDate.prototype;
  // Close the (new Date(x)).constructor backdoor to RealDate.now — point
  // .constructor at the shim, then freeze RealDate so it can't be undone.
  RealDate.prototype.constructor = ShimDate;
  Object.freeze(RealDate);
  globalThis.Date = ShimDate;
})()`

// ant 3860 DaH — SES-style context hardening. Freezes builtin intrinsics and
// their prototypes, removes ShadowRealm/WebAssembly, and applies the TC39
// "override mistake" workaround (enable-property-override) so that freezing
// Object.prototype etc. doesn't break legitimate instance-property assignment
// (e.g. `this.name = 'X'` in an Error subclass constructor).
const HARDEN_SHIM = `(() => {
  Object.defineProperty(Error, 'prepareStackTrace', {
    value: (err, sites) => String(err.stack ?? err),
    writable: false, configurable: false,
  });
  delete globalThis.ShadowRealm;
  delete globalThis.WebAssembly;
  function enableOverride(proto, key) {
    const d = Object.getOwnPropertyDescriptor(proto, key);
    if (!d || 'get' in d) return;
    const v = d.value;
    Object.defineProperty(proto, key, {
      get() { return v },
      set(nv) {
        if (this === proto) return;
        Object.defineProperty(this, key, { value: nv, writable: true, enumerable: true, configurable: true });
      },
      enumerable: d.enumerable, configurable: true,
    });
  }
  const errorProtos = [Error, EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError, AggregateError].map(C => C.prototype);
  for (const [proto, keys] of [
    [Object.prototype, Object.getOwnPropertyNames(Object.prototype)],
    [Function.prototype, ['toString', 'constructor', 'name', 'length']],
    [Array.prototype, ['toString', 'constructor']],
    [Date.prototype, ['toString', 'toLocaleString', 'valueOf', 'constructor']],
    ...errorProtos.map(p => [p, ['name', 'message', 'toString', 'constructor']]),
  ]) for (const k of keys) enableOverride(proto, k);
  for (const C of [
    Promise, Object, Array, Function, Error,
    EvalError, RangeError, ReferenceError, SyntaxError, TypeError, URIError, AggregateError,
    Date, Map, Set, WeakMap, WeakSet, RegExp,
    ArrayBuffer, SharedArrayBuffer, DataView, Object.getPrototypeOf(Int8Array),
    Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
    Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array,
    typeof URL !== 'undefined' ? URL : undefined,
    typeof Iterator !== 'undefined' ? Iterator : undefined,
  ]) {
    if (C === undefined) continue;
    Object.freeze(C);
    Object.freeze(C.prototype);
  }
  for (const it of [
    [][Symbol.iterator](),
    ''[Symbol.iterator](),
    new Map()[Symbol.iterator](),
    new Set()[Symbol.iterator](),
    (function*(){})(),
    (async function*(){})(),
  ]) {
    for (let p = Object.getPrototypeOf(it); p; p = Object.getPrototypeOf(p)) {
      Object.freeze(p);
    }
  }
})()`

/**
 * ant 3860 cD6 — inject the determinism shim into a context.
 */
export function applyDeterminismShim(context: vm.Context): void {
  vm.runInContext(DETERMINISM_SHIM, context)
}

/**
 * ant 3860 DaH — harden a context (freeze intrinsics, strip escape hatches).
 */
export function hardenContext(context: vm.Context): void {
  vm.runInContext(HARDEN_SHIM, context)
}

/**
 * ant 3860 rt7 — return a context-bound async identity function. The hook
 * factory uses this as `bindVMAwait` so that values awaited inside the script
 * are unwrapped against the SANDBOX's Promise/thenable machinery rather than
 * the host's — a host Promise awaited in the vm context can otherwise hang
 * because the two realms' microtask adoption disagree.
 */
export function makeVMAwait(
  context: vm.Context,
): (v: unknown) => Promise<unknown> {
  return vm.runInContext('(async v => v)', context) as (
    v: unknown,
  ) => Promise<unknown>
}

// ant 3859 it7 — abort-aware setTimeout/clearTimeout pair. When the abort
// signal fires, all outstanding timers are cleared. Exposed into the sandbox so
// a script's own setTimeout calls (e.g. backoff delays inside a custom harness)
// don't outlive a killed workflow. Both functions are prototype-stripped so
// they can't be used as an escape hatch.
export function createAbortAwareTimers(signal?: AbortSignal): {
  setTimeout: (cb: () => void, ms: number) => number
  clearTimeout: (id: number) => void
} {
  const ids = new Set<number>()
  signal?.addEventListener(
    'abort',
    () => {
      for (const id of ids) clearTimeout(id)
      ids.clear()
    },
    { once: true },
  )
  return {
    setTimeout: stripPrototype((cb: () => void, ms: number): number => {
      if (signal?.aborted) return 0
      const id = Number(setTimeout(cb, ms))
      ids.add(id)
      return id
    }),
    clearTimeout: stripPrototype((id: number): void => {
      ids.delete(id)
      clearTimeout(id)
    }),
  }
}

export type CompileResult =
  | { ok: true; vmScript: vm.Script }
  | { ok: false; error: string }

/**
 * ant 3859 nD6 — compile a workflow script BODY (the part after the `meta`
 * literal) into a runnable vm.Script. The body is wrapped in an async IIFE so
 * top-level `await` and `return` work. A second `Function(...)` parse is done
 * first purely to surface a clean SyntaxError message (the vm.Script wrap would
 * report a confusing offset).
 *
 * The returned script, when run in a context, evaluates to the IIFE's Promise.
 */
export function compileWorkflowScript(scriptBody: string): CompileResult {
  const wrapped = `(async () => {\n${scriptBody}\n})()`
  try {
    // Parse-check for a clean error message first (ant nD6 does the same).
    // eslint-disable-next-line no-new-func
    new Function(`async function _check() {\n${scriptBody}\n}`)
    return {
      ok: true,
      vmScript: new vm.Script(wrapped, { filename: 'workflow.js' }),
    }
  } catch (e) {
    return {
      ok: false,
      error: `SyntaxError: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}
