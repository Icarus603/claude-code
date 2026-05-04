# Post-V8 Cleanup — Baselines & Status

> 90+ commits across iterations 1–27 on 2026-04-29 → 2026-04-30.
> Continuing the V8 cleanup pattern: extending coverage in low-tested
> packages, completing 4 silent-failure audits, and consolidating
> baselines for the next iteration.
>
> **Updated 2026-05-04** with current real values after several rounds
> of incremental shim removal, deps_setter migrations, and Kairos
> subsystem 1–4 implementations. The "Now" column reflects today's
> measured state; the original V8-final and post-V8-Iter-27 values
> are preserved for delta visibility.

This document records the **current state** of every monotonic-shrink
ratchet, so future sessions can detect regressions even after
context compaction.

## Current Numbers

| Metric                              | V8 final | Iter-27 | 2026-05-04 | Δ since V8 |
|-------------------------------------|---------:|--------:|-----------:|-----------:|
| Tests passing                       |     3078 |    5479 |       8217 | +5139      |
| Test files                          |     ~110 |     214 |        448 | +338       |
| `doctor:arch` checks                |       66 |      72 |         77 | +11        |
| `_DEPRECATED` exports in packages/  |        0 |       0 |          0 | locked     |
| `_deps.ts` cross-package lazy-requires |    1 |       1 |          0 | -1 (V9-1)  |
| `_deps.ts` unknown-typed slots      |        7 |       6 |          6 | locked     |
| Knip unused-files (packages/-scoped) |      71 |      69 |          9 | -62        |
| Knip unused-exports                 |      185 |     184 |         33 | -152       |
| tsc-errors budget                   |     3269 |    3217 |       3179 | -90        |
| Silent-failure findings (total)     |      740 |     740 |        737 | -3         |
| Silent-failure CRITICAL/HIGH        |      0/0 |     0/0 |        0/0 | locked     |
| `as never` cast count               |      n/a |      42 |         42 | locked     |
| Error codes (cross-package)         |      n/a |      75 |         75 | 0 collisions |
| Real bugs found                     |        4 |       7 |          7 | +3         |

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
  - **2026-05-04 update**: The V9 plan is now written:
    `docs/refactor/v9-deps-shrinkpath.md`. Three earlier hypotheses
    have been corrected during inventory (the AppState/AppStateCompat
    "double type" was actually a 3-file re-export chain; the
    `cli/headless.ts` 4 `= unknown` were not dead types but V7 §7.2
    boundary shims; the real TS2322 root cause is TaskState
    double-union, not AppState). The next ralph-loop session can
    execute V9-1 directly without re-doing inventory.
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

Current baselines (locked, monotonic-shrink-only) — measured 2026-05-04:

```
verify-tsc-errors                = 3179
verify-deps-quality              = lazy-requires=0, unknown-slots=6 (V9-1 ratchet 2026-05-04)
verify-knip-headroom             = unused-files=9, unused-exports=33
verify-silent-failure-ratchet    = 737 (CRITICAL=0, HIGH=0)
                                   sub-buckets: empty-catch=0,
                                   nullish-coalesce-critical-path=86,
                                   stub-return-only=25,
                                   always-false-feature-flag=492,
                                   type-cast-trap=134,
                                   require-fallback-to-stub=0
verify-error-codes-unique        = 75 codes, 20 files, 0 collisions
verify-as-never-ratchet          = 42 (locked)
verify-console-log-leak          = 186 (locked)
verify-exports-budget            = baseline JSON; per-package locked
verify-no-sync-fs-in-render      = 15 (locked)
verify-stale-todo-comments       = 120 (locked)
verify-file-size                 = grandfathered (see file-size-baseline.json,
                                   136 entries, top 7 files >4000 LOC are
                                   single-responsibility-by-nature)
```

## Why the Iter-27 → 2026-05-04 deltas look big

The two large numbers — `Knip unused-files 69 → 9` and
`unused-exports 184 → 33` — reflect **scope correction**, not new
deletions. The Iter-27 baseline counted the entire knip report
(including `scripts/` audit-tooling and unused exports inside test
fixtures); `verify-knip-headroom` was tightened to count **only
files inside `packages/`** (the shipping surface). The audit-tooling
files knip flags are deliberate — they are CLI verifiers invoked from
package.json scripts, not library code. The new ratchet matches the
domain that actually matters.

The 33 unused-exports include 4 in `cli/src/headless.ts` that are
`= unknown` placeholders left by decompilation. Reviewed
2026-05-04 — these are V9 host-binding-consolidation territory; the
correct fix is replacing them with real types from `mcp-runtime`,
`provider`, and `headless-sdk`, not deleting them. Held under
ratchet until V9.
