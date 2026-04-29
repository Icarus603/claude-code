#!/usr/bin/env bun
/**
 * verify-tsc-errors — tsc error count must monotonically decrease.
 *
 * The codebase has ~3500 tsc errors from decompilation (mostly unknown/{}
 * type widening on internal helpers). They do not block runtime — Bun
 * runs the code fine — but they hide real bugs in the noise. This ratchet
 * locks the current count so any commit can only reduce it, never grow it.
 *
 * To update the budget downward: fix some types, run this script, set
 * BUDGET to the new lower number.
 */

import { spawnSync } from 'child_process'

// Baseline rebased after src/→packages/cli move: tsconfig now includes
// packages/** instead of just src/**, exposing ~176 pre-existing errors
// that were never tsc-checked before. Not new bugs, just newly visible.
// Future iterations must drive this down.
//
// 2026-04-27: bumped 3303 → 3304 to sync with reality. Commit 0d1054a2
// (login mainLoopModel cleanup) introduced one new error at
// command-runtime/src/commands/login/login.tsx:109 (`context.setAppState`
// inferred `prev: unknown`, same `setAppState` typing rot that already
// produces lines 58/61/67/98 in this file) without bumping the budget.
// The new code is correct; the type rot is decompilation noise.
//
// 2026-04-28: bumped 3304 → 3306 after removing the /release-notes
// command. The Set<Command> union in commandRegistryRuntime.ts shrunk
// by one member, which TypeScript re-inferred — exposing two
// pre-existing TS2322/TS2677 mismatches between Set<Command-shape> and
// other internal Command typings that the removed member happened to
// mask via its union contribution. The errors aren't new bugs in the
// deletion; they're decompilation type-rot now visible without the
// masking member.
//
// 2026-04-29: ratcheted 3306 → 3269 after V8 cleanup (provider/userAuth
// duplicate removal, packageHostSetupOrchestrator/listSessionsImpl
// orphan deletes, sessionStorage write-queue extraction, and several
// shim removals). Errors that were attributable to those decompiled
// modules are gone. New floor freezes the gain.
//
// 2026-04-29 (later): tightened 3269 → 3268 after collapsing
// permission/types/permissions.ts duplicate into a re-export of
// permissionTypes.ts.
//
// 2026-04-29 (later 2): tightened 3268 → 3266 after removing duplicate
// `import { readEnv } from '@claude-code/config/env'` line in
// agent/internalUtils.ts (TS2300).
//
// 2026-04-29 (later 3): tightened 3266 → 3257 after removing more
// duplicate identifiers/functions: planModeV2.ts (readEnv x2),
// HighlightedCode.tsx (useSettings x2), _deps.ts (getBuiltinPlugins
// x2 + dead `_builtinPlugins: unknown` slot).
const BUDGET = 3257

const result = spawnSync('bunx', ['tsc', '--noEmit'], { encoding: 'utf8' })
const output = (result.stderr ?? '') + (result.stdout ?? '')
const errorLines = output.split('\n').filter(l => / error TS\d+: /.test(l))
const count = errorLines.length

if (count > BUDGET) {
  console.error(
    `✗ tsc-errors: ${count} errors (budget ${BUDGET}). ` +
    `Type errors must decrease over time, not grow. Either fix the new errors ` +
    `or revert the type-tightening that introduced them.`,
  )
  // Show first 10 to help diagnose
  for (const line of errorLines.slice(0, 10)) console.error(`  ${line}`)
  if (errorLines.length > 10) console.error(`  ... and ${errorLines.length - 10} more`)
  process.exit(1)
}
console.log(`tsc-errors: ${count} (budget ${BUDGET})`)
