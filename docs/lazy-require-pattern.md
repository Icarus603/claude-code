# Lazy-require pattern (V7 §3.2 idiom)

## What

A way to call into a canonical owner package from a setter shim default
when a static import would form a dependency cycle. Used in
`packages/config/plugin/_deps.ts` (and similar `_deps.ts` files) when
the package needs to invoke logic owned by a higher-layer package
without the static `import` graph showing config → mcp-runtime/agent
(which would re-create the cycle the layered architecture is trying
to prevent).

## When to use

Apply when **all three** are true:

1. `_deps.ts` exposes a setter shim with a non-trivial default behavior
   (callers expect a function call, an object with specific shape, or
   a non-empty result).
2. The canonical impl lives in a package that already imports from
   `_deps.ts`'s package, so a static import here would form a cycle.
3. Host bindings *should* wire the setter at boot but don't reliably
   do so (every unwired setter with a dangerous default is a latent
   bomb — see #103, #114).

## When NOT to use

- **Within the same package** — just import directly.
- **Setter default is semantically correct** (e.g., logging drop,
  cache-clear no-op, identity passthrough). Lazy-require adds complexity
  without fixing a real bug.
- **The canonical impl is also in a leaf package** — both packages
  could move to a shared lower layer instead.

## Shape

```ts
// Type the result so destructure-style consumers work even on fallback.
type ExpandEnvVarsResult = { expanded: string; missingVars: string[] }

// Cache the resolved canonical so we only require() once per process.
let _cachedExpandEnvVarsInString:
  | ((s: string) => ExpandEnvVarsResult)
  | null = null

// makeSetter still exists so host bindings *can* override at boot,
// but the default itself does the lazy-require.
const [_getExpandEnvVarsInString, setExpandEnvVarsInStringFn_] = makeSetter(
  (s: string): ExpandEnvVarsResult => {
    if (_cachedExpandEnvVarsInString == null) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const mod = require('@claude-code/mcp-runtime/envExpansion.js') as {
          expandEnvVarsInString?: (s: string) => ExpandEnvVarsResult
        }
        if (typeof mod.expandEnvVarsInString === 'function') {
          _cachedExpandEnvVarsInString = mod.expandEnvVarsInString
        }
      } catch {
        // canonical not loadable — fall back to a sane no-op.
      }
    }
    return _cachedExpandEnvVarsInString
      ? _cachedExpandEnvVarsInString(s)
      : { expanded: s, missingVars: [] }
  },
)

// Public export uses the canonical signature, not the historical setter
// signature, so destructuring callers see the right shape.
export function expandEnvVarsInString(s: string): ExpandEnvVarsResult {
  return _getExpandEnvVarsInString()(s)
}
```

## Why this beats the setter pattern

The legacy "setter shim with default + setXxxFn at boot" pattern has
three failure modes:

1. **Default doesn't match canonical's shape.** Caller does
   `const { expanded, missingVars } = expandEnvVarsInString(...)`,
   default returns bare `string`, destructure → `missingVars = undefined`,
   `[...undefined]` → "Spread syntax requires ...iterable not be null".
   This is what broke plugin loading 4× this session.
2. **Setter is never wired.** Host's `installXxxBindings.ts` only wires
   the ones it knows about; new setters get added but not wired,
   default leaks to production.
3. **Boot order matters.** If consumer fires before bindings install,
   default is active. Hard to debug because in tests it usually works.

Lazy-require addresses all three:
1. The default itself is the canonical impl (resolved on first call),
   so signatures match.
2. Setter wiring becomes optional (still respected if present, harmless
   if absent).
3. Boot order doesn't matter — first call resolves and caches.

The only cost is a try/catch + require on first call (sub-millisecond).

## Cycle safety

Static `import { x } from '@other'` adds an edge in the static import
graph that bundlers (and our `verify-no-cycles` ratchet) walk to find
cycles. `require('@other')` inside a function body is **not** a static
edge — it resolves at call time. As long as the call site fires after
both packages have finished their module-load phase, this is safe.

If the call fires *during* module load (i.e., at top level of the
calling package), the lazy-require may fail — `require` from a
not-yet-loaded module returns its current state. Always invoke
lazy-require helpers from within functions that run after boot, never
from top-level code in `_deps.ts`.

## Currently using this pattern

As of HEAD (Phase-3 batch 1), 7 setters in `packages/config/plugin/_deps.ts`:

- `McpServerConfigSchema` → `@claude-code/mcp-runtime/types`
- `expandEnvVarsInString` → `@claude-code/mcp-runtime/envExpansion`
- `parseFrontmatter` → `@claude-code/agent/frontmatterParser`
- `extractDescriptionFromMarkdown` → `@claude-code/tool-registry/markdownConfigLoader`
- `expandTilde` → `@claude-code/permission/pathValidation`
- `executeShellCommandsInPrompt` → `@claude-code/command-runtime/promptShellExecution`
- (plus the original parseFrontmatter wrapper before today's session)

Each was a real bomb that fired in production usage; all six are now
covered by `tests/integration/plugin-load.test.ts`.
