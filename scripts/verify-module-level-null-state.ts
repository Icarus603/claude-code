#!/usr/bin/env bun
/**
 * verify-module-level-null-state — `let X: T | null = null` at module
 * level must have at least one in-file write site.
 *
 * Same disease class as the unwired setter slot: declare a placeholder,
 * assume someone external will initialize it, never write the wire.
 * Lazy-init via `??=`/`||=` counts as a write.
 *
 * Allow-comment: place `// verify-module-level-null-state: allow (reason)`
 * on the line preceding the declaration.
 */
import { execSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const AUDIT = join(
  REPO_ROOT,
  'scripts/audit-silent-failures/12-module-level-null-state.ts',
)

interface Finding {
  pattern: string
  file: string
  line: number
  snippet: string
  severity: string
  note: string
}

async function main(): Promise<void> {
  const stdout = execSync(`bun ${AUDIT}`, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  })
  const result = JSON.parse(stdout) as { findings: Finding[] }

  const violations: Finding[] = []
  for (const f of result.findings) {
    const text = await readFile(f.file, 'utf8').catch(() => '')
    if (!text) {
      violations.push(f)
      continue
    }
    const lines = text.split('\n')
    const prev = lines[f.line - 2] ?? ''
    if (/verify-module-level-null-state:\s*allow/.test(prev)) continue
    violations.push(f)
  }

  if (violations.length > 0) {
    console.error('verify-module-level-null-state: violations')
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} — ${v.snippet}`)
    }
    throw new Error(
      `${violations.length} module-level null states without in-file writers. ` +
        `Add a setter, use lazy init via \`??=\`, or delete the variable.`,
    )
  }
  console.log('verify-module-level-null-state: clean')
}

await main()
