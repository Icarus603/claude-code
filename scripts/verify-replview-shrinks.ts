#!/usr/bin/env bun
/**
 * verify-replview-shrinks — REPLView.tsx LOC must monotonically decrease.
 *
 * V7 §3.3 thin-host policy. The REPL function is the largest remaining
 * domain-orchestration host. We can't decompose it in one iteration without
 * regression risk, so this ratchet enforces incremental progress: every
 * commit can only shrink REPLView, never grow it.
 *
 * To update the budget: extract a section, verify tests pass, then update
 * the constant below to the new (lower) line count.
 */

import { readFile } from 'fs/promises'

const BUDGET = 5736 // +45: mid-turn graceful abort before the left-arrow bridge forks — abort('background') + wait for queryGuard idle so the forked worker resumes a COMPLETE transcript (fixes right-arrow-returns-to-deadlock)

async function main() {
  const content = await readFile('packages/repl/src/screens/REPLView.tsx', 'utf8')
  const loc = content.split('\n').length
  if (loc > BUDGET) {
    throw new Error(
      `REPLView.tsx grew to ${loc} LOC (budget ${BUDGET}). V7 §3.3: thin host must shrink monotonically. ` +
      `Decompose a section before merging, OR document why this is unavoidable and update the budget downward.`,
    )
  }
  console.log(`REPLView.tsx: ${loc} LOC (budget ${BUDGET})`)
}

main().catch(e => { console.error(e); process.exit(1) })
