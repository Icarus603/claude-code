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

const BUDGET = 3478 // post-#91 — 4 errors disappeared as canonical-path resolution improved types

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
