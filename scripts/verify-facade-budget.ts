#!/usr/bin/env bun
/**
 * verify-facade-budget — count V7 §10.3 init-side-effect facades in src/.
 * These are intentional setter-callback wirers (envUtils, format, cachePaths,
 * etc.) that must run as side effects at boot. They live in src/ rather
 * than packages/ because the ordering is anchored to the entrypoint.
 *
 * They are exempt from src-shrinks but easy to abuse — every "I just need a
 * little setter wiring here" tempts a new facade. This budget locks the
 * current count so the list can shrink (when a facade gets folded into its
 * package) but cannot silently grow.
 */

import { Glob } from 'bun'
import { readFile } from 'fs/promises'

const BUDGET = 47

let count = 0
for await (const file of new Glob('src/**/*.{ts,tsx}').scan('.')) {
  const content = await readFile(file, 'utf8')
  if (/§10\.3/.test(content)) count += 1
}

if (count > BUDGET) {
  console.error(
    `✗ facade-budget: ${count} §10.3 facades in src/ (budget ${BUDGET}). ` +
    `New facades require deliberate justification — fold into the owning package if possible, ` +
    `or update the budget upward with a comment explaining why.`,
  )
  process.exit(1)
}
console.log(`facade-budget: ${count} §10.3 facades (budget ${BUDGET})`)
