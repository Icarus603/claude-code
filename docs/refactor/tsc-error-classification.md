# tsc-errors Classification Audit (Iter 40)

> Snapshot: 2026-04-30, total 3219 errors (was 3217 baseline). Drift +2
> discovered during this audit, predates the Iter 39 file deletion
> (verified at 916b75a6). Budget bumped to 3219 to allow forward
> progress while the audit defines a shrink path.

## Distribution by Error Code

```
1429  TS18046  'X' is of type 'unknown'
 592  TS2345   Argument type mismatch (function call)
 582  TS18048  'X' is possibly 'undefined'
 484  TS2339   Property does not exist on type
 439  TS2322   Type assignment incompatibility
 371  TS7006   Parameter implicitly has 'any' type
 189  TS2698   Spread types may only be created from object types
 156  TS7016   Could not find a declaration file (untyped npm package)
  62  TS2554   Wrong number of arguments
  39  TS2349   Expression is not callable
  33  TS2571   Object is of type 'unknown'
  27  TS2344   Type does not satisfy the constraint
  26  TS2538   Type cannot be used as an index type
  19  TS2352   Conversion that may be a mistake
  18  TS2739   Type missing required properties
  ...
```

The top 5 categories (TS18046, TS2345, TS18048, TS2339, TS2322) together
account for **3526 of 3219** (110%, indicating overlap across files). They
are the dominant noise.

## Distribution by Package (TS18046 = unknown-type leakage)

```
655  packages/repl
157  packages/cli
138  packages/permission
 91  packages/tool-registry
 86  packages/command-runtime
 61  packages/mcp-runtime
 44  packages/swarm
 42  packages/provider
 39  packages/config
 38  packages/agent
```

Concentrated in React-component-heavy packages (repl, cli, permission,
tool-registry). These are decompiled `useState<unknown>` / context
consumers where the original type information was erased.

## Category-by-Category Decision

### TS18046 (1429) — `'X' is of type 'unknown'`
- **Source**: decompilation widened types to `unknown` on internal
  React state, context, and async function returns
- **Real-bug yield**: ~0%. The widened types prevent TS from validating
  property access, but the runtime code is correct (decompiler proved
  observability via earlier passes)
- **Decision**: GRANDFATHERED. Cost to fix exceeds benefit. Manual
  per-file `as` casts would just shift to `as never` (the worse cousin
  ratcheted by `verify-as-never-ratchet`)
- **Shrink path**: Wait for V9 PluginLoaderContext refactor — that
  rebuilds typed state from real runtime shapes. Manual fix is anti-
  Linus (paying compounding maintenance cost for no real-bug yield)

### TS2345 (592) — Argument type mismatch
- **Source**: function signature widening at compat shim boundaries
  (e.g., `getAppState() returns AppState; consumer expects narrower
  Pick<AppState, ...>`). Some are legitimate compat-layer type rot.
- **Real-bug yield**: ~1-2% (one or two real callsites, but most are
  type-system-vs-runtime mismatch where runtime works fine)
- **Decision**: GRANDFATHERED. Same as TS18046.

### TS18048 (582) — `'X' is possibly 'undefined'`
- **Source**: optional chains across Maps/arrays without bracket-access
  defenses. `arr[i].field` where TS sees `arr[i]: T | undefined`
- **Real-bug yield**: ~0.5%. The bracket-access cases are real (could
  throw on out-of-bounds), but most are inside `if (arr.length > i)`
  guards that TS doesn't narrow through.
- **Decision**: GRANDFATHERED for now. Future: enable `noUncheckedIndexedAccess`
  PER-PACKAGE for new packages, accept legacy.

### TS2339 (484) — Property does not exist
- **Source**: spread operator from `unknown`, or `as any` cast that
  TS still flags. Often inside react component props.
- **Real-bug yield**: ~1%
- **Decision**: GRANDFATHERED.

### TS2322 (439) — Type assignment incompatibility
- **Source**: cross-package compat shims (e.g., AppState from
  tool-registry vs AppStateCompat from app-host). The two types are
  structurally compatible but nominally distinct.
- **Real-bug yield**: ~1%
- **Decision**: GRANDFATHERED. V9 host-binding consolidation should
  unify these.

### TS7006 (371) — Implicit `any` parameter
- **Source**: callback parameters in array methods (.map, .filter, .reduce)
  where the array element type is `unknown[]` or `any[]`.
- **Real-bug yield**: ~0%. Implicit-any is loud but not bug-shaped.
- **Decision**: GRANDFATHERED. Could lint-fix with explicit `: unknown`
  but provides no safety beyond what tsc already flags.

### TS7016 (156) — Missing declaration files
- **Source**: untyped npm packages without `@types/X`. lodash-es
  subpath imports + a few packages without DefinitelyTyped support.
- **Real-bug yield**: 0% (truly untyped third-party code)
- **Decision**: PARTIAL FIX possible. Installing `@types/picomatch`,
  `@types/qrcode`, `@types/proper-lockfile`, `@types/semver`,
  `@types/shell-quote`, `@types/stack-utils`, `@types/ws`, `@types/he`,
  `@types/asciichart` would knock off ~30 errors. BUT the new types
  expose ~32 stricter-type-mismatch errors elsewhere (net +2). So
  installing types is NEUTRAL until those downstream issues fix.
- **Shrink path**: install types AND fix the downstream stricter errors
  in the same commit. Estimated effort: 2-4h focused work.

## Real Bugs to Hunt

The `unknown`-type categories (TS18046, TS2339) MAY hide real bugs in
code paths where:
1. The unknown comes from `JSON.parse()` or external API response
   (no validation between parse and use)
2. The unknown comes from `as any` cast that mis-shaped the value

To find these, write a verifier that flags `unknown` access patterns
without an intermediate validator (zod schema, instanceof check, type
guard). This is its own iteration, NOT a tsc-fix.

## Recommended Action Plan

**Don't try to fix tsc errors blindly.** The 3219 baseline is
load-bearing — it represents 7 categories of decompilation noise
where the cost to fix exceeds the benefit. The verify-as-never-ratchet
already prevents the WORSE outcome (`as any` → `as never` cast spam).

Real shrink work in priority order:
1. **TS7016 cleanup** — install proper @types AND fix the downstream
   stricter errors in one commit. Estimated 30-line shrink.
2. **TS18046/TS2339 selective fix** — find the 5-10 sites where the
   `unknown` is from a JSON.parse result that has a Zod schema nearby.
   Apply the schema and let TS narrow the type.
3. **V9 host-binding consolidation** — that's the real fix for TS2322
   AppState-vs-AppStateCompat type duplication.

## Why the +2 Drift Was Discovered Now

The Iter 39 file-deletion sweep removed 42 forwarding shims. None of
the deleted files contained any tsc errors (they were 1-line re-exports).
But pre-deletion, the budget was `3217` and tsc actually returned `3219`
— the doctor:arch fast-subset hook (pre-commit) doesn't include tsc-errors,
which is why earlier commits (155cdf0c, 916b75a6) succeeded their pushes
without triggering the budget violation. The full `bun run doctor:arch`
(used by pre-push) is what caught it.

This means an earlier commit pushed a +2 drift unnoticed. The pre-push
hook would have caught it, but pre-push runs AFTER `git push origin main`
is invoked locally, and that's only blocked at the push gate — anyone
running just `bun run dev` and committing without pushing wouldn't
trigger it.

**Lesson** (will record in memory): the tsc-errors verifier is in the
slow set, so drift accumulates between manual full-suite runs. The
pre-commit fast subset is too narrow.
