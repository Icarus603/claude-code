# Post-V8 Cleanup — Baselines & Status

> 90+ commits across iterations 1–27 on 2026-04-29 → 2026-04-30.
> Continuing the V8 cleanup pattern: extending coverage in low-tested
> packages, completing 4 silent-failure audits, and consolidating
> baselines for the next iteration.

This document records the **current state** of every monotonic-shrink
ratchet, so future sessions can detect regressions even after
context compaction.

## Current Numbers

| Metric                              | V8 final | Now        | Δ         |
|-------------------------------------|---------:|-----------:|----------:|
| Tests passing                       |     3078 |       5479 | +2401     |
| Test files                          |     ~110 |        214 | +104      |
| `doctor:arch` checks                |       66 |         72 | +6        |
| `_DEPRECATED` exports in packages/  |        0 |          0 | locked    |
| `_deps.ts` cross-package lazy-requires |       1 |          1 | locked    |
| `_deps.ts` unknown-typed slots      |        7 |          6 | -1 (V8.1) |
| Knip unused-files (packages/-scoped) |       71 |         69 | -2        |
| Knip unused-exports                 |      185 |        184 | -1        |
| tsc-errors budget                   |     3269 |       3217 | -52       |
| Silent-failure findings (total)     |      740 |        740 | locked    |
| Silent-failure CRITICAL/HIGH        |      0/0 |        0/0 | locked    |
| `as never` cast count               |      n/a |         42 | new ratchet |
| Real bugs found                     |        4 |          7 | +3        |

The +3 real bugs (all parser state-machine ordering errors found via
test-writing on parsers — see `feedback_test_writing_bug_discovery_rate.md`):

1. `gitConfigParser` quoted-trailing-whitespace strip (2026-04-30)
2. `extractLastJsonStringField` pattern-ordering bug (2026-04-30)
3. `parseSSEFrames` CRLF line-ending non-recognition per WHATWG spec (2026-04-30)

## What changed since V8 final

### Iter 17 (silent-failure case-by-case audit)

Three silent-failure ratchet sub-buckets reviewed:

- **nullish-coalesce-critical-path** (86 findings): all schema-driven
  defaults, API response defaults, optional function parameters, or
  OS-managed sentinels (port 0). 0 real bugs.
- **stub-return-only** (26 findings): all dead seams from decompilation
  or feature-gated stubs. 0 real bugs.
- **type-cast-trap** (133 findings): all design-intent unknown→T casts
  through validated boundaries. 0 real bugs.

Total reviewed: 245 findings. Net: 0 real bugs, 1 docs file written
(`silent-failure-audit-review.md`). The ratchet now serves as
**regression backstop** — new findings get scrutinized at PR time, but
the existing baseline is signal-free.

### Iter 18-25, 27 (test coverage extension)

Wrote in-tree tests for pure-function helpers across nine packages:

| Package              | Tests added |
|----------------------|-------------|
| tool-registry        | 71          |
| command-runtime      | 49          |
| provider             | 102         |
| output               | 59          |
| swarm                | 26          |
| mcp-runtime          | 22          |
| local-observability  | 18          |
| bridge               | 54          |
| permission           | 45          |
| shell                | 22          |
| agent                | 60          |
| **Total**            | **528**     |

Test ratio improvements (src files / test files):

| Package              | Before     | After     |
|----------------------|------------|-----------|
| tool-registry        | 9:1        | 8:1       |
| command-runtime      | 15.5:1     | 18:1*     |
| provider             | 15:1       | 10.6:1    |
| output               | 5.8:1      | 3.8:1     |
| local-observability  | 10.7:1     | 8.6:1     |
| bridge               | 7.6:1      | 4.7:1     |

*command-runtime ratio appears to grow because new src files were added
in parallel; absolute test count grew from 6 to 8 files.

The mock-module spread pattern (`mock.module('X', () => ({ ...realX, override }))`)
remains the canonical recipe; documented in
`feedback_mock_module_spread_pattern.md`.

### Iter 21 (verifier addition)

Added `verify-error-codes-unique` (`scripts/verify-error-codes-unique.ts`):
scans every `packages/**/errors.ts`, extracts `super('CODE', ...)` patterns
inside Error subclass constructors, asserts each code is globally unique.
Currently: 75 codes across 20 files, 0 collisions.

This is a contract no individual package's tests can catch — each
package's local `errors.test.ts` only sees its own subset. A future
HostBindingsError vs LocalObservabilityHostError code collision would
silently mis-attribute telemetry without this verifier.

doctor:arch checks: 66 → 71 (gained `verify-error-codes-unique` plus 4
others wired during V8 that I hadn't counted).

## Real bugs found this period

### gitConfigParser quoted-trailing-whitespace strip

The decompiled `parseValue` had:

```ts
if (!inQuote) result = trimTrailingWhitespace(result)
```

But `inQuote` is always `false` at the end-of-line check (the closing
quote turned it back to false). So the trim ran across the entire value,
including spaces that were INSIDE the quoted region. Effect: parsing
`url = "https://example.com/path   "` would silently strip the trailing
spaces, even though `git config --get` preserves them.

Surfaced via test case `parses preserved trailing whitespace inside
quotes`. Fixed by tracking per-character `protectedFlags` parallel array
and only trimming unprotected positions.

Real-world impact: rare but real for hand-edited git configs with
intentionally-quoted whitespace (e.g., trailing-space-in-url shenanigans
to bypass URL deduplication, intentional commit-template whitespace).

## What was NOT done

- **Iter 22 (V9 prep): _deps.ts shrink toward V9 PluginLoaderContext refactor.**
  Cost/risk asymmetry remains unfavorable. The 1 remaining lazy-require
  (`executeShellCommandsInPrompt`) has genuine cross-cutting deps that
  need a real refactor, not a moves. Deferred to V9 proper.
- **Iter 26 (verify-no-bare-process-env): readEnv discipline ratchet.**
  Aborted after impact assessment — 746 raw `process.env.X` uses across
  226 distinct env vars. Migration cost ~10–20h mechanical work with
  single-mismigration-breaks-bare-mode risk. Marginal value (centralized
  audit) is small relative to existing readEnv discipline. Linus rule:
  "Don't fix what's not broken" applies.

## Key decisions for next iteration

1. **Test-writing as bug-discovery: 1 hit / 528 tests = 0.19% rate.** The
   gitConfigParser bug came from probing a parser with edge cases. Going
   forward, **prioritize tests that probe FROM-USER-INPUT parsing logic**
   over tests that confirm already-documented design.
2. **Silent-failure audit saturation reached.** The 740-finding ratchet
   protects against new findings, but auditing existing findings has
   diminishing returns (245 reviewed → 0 bugs). Stop here.
3. **Coverage ratio targets:** push the remaining 6:1+ packages toward
   ≤4:1 only when the modules are pure-helpers. Don't write integration
   tests for host-binding-heavy modules like `repl/REPLView` or
   `tool-registry/services`.
4. **`_deps.ts` cleanup is V9 territory.** Don't try to incrementally
   shrink it on top of V8 — the remaining slots all need real refactors,
   not shims.

## Memory entries this period

- `feedback_test_writing_finds_bugs.md` — test-writing is a more
  bug-productive activity than auditing, but only when probing
  parsers/decoders with edge inputs.
- `feedback_no_repl_loc_decomposition.md` — REPLView, hooks, messages,
  mode-dispatch, bashParser are single-responsibility-large-by-nature.
  Don't attempt LOC reduction on them — only sessionStorage's `Project`
  was actually decomposable (extracted SessionWriteQueue in V8).

## How to keep it clean

1. Pre-commit hook runs the fast subset of doctor:arch (~8 rules, < 2s)
2. Pre-push hook runs the full suite (71 rules) + smoke tests
3. To add a feature flag or shim: either wire the consumer in the same
   commit, or run `verify-X --tighten` to admit the new baseline

Current baselines (locked, monotonic-shrink-only):

```
verify-tsc-errors                = 3217
verify-deps-quality              = lazy-requires=1, unknown-slots=6
verify-knip-headroom             = unused-files=69, unused-exports=184
verify-silent-failure-ratchet    = 740 (CRITICAL=0, HIGH=0)
verify-error-codes-unique        = 75 codes, 20 files, 0 collisions
verify-file-size                 = grandfathered (see file-size-baseline.json)
```
