#!/usr/bin/env bun
/** Require every external GitHub Action to use a full 40-character SHA. */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const workflowDir = '.github/workflows'
const failures: string[] = []

for (const name of await readdir(workflowDir)) {
  if (!name.endsWith('.yml') && !name.endsWith('.yaml')) continue
  const path = join(workflowDir, name)
  const lines = (await readFile(path, 'utf8')).split('\n')
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^\s*-?\s*uses:\s*([^\s#]+)/)
    if (!match) continue
    const target = match[1]!
    if (target.startsWith('./') || target.startsWith('docker://')) continue
    if (!/@[0-9a-f]{40}$/i.test(target)) {
      failures.push(`${path}:${index + 1}: ${target}`)
    }
  }
}

if (failures.length > 0) {
  console.error('workflow-action-pins: FAIL')
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log('workflow-action-pins: OK (all external actions use full SHAs)')
