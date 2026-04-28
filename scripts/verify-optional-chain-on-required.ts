#!/usr/bin/env bun
/**
 * verify-optional-chain-on-required — `binding.method?.()` where
 * `method` is declared non-optional in any contract is forbidden.
 *
 * The `?.()` silently degrades when the binding wasn't installed,
 * masking V7-style "slot declared, wire missing" failures.
 *
 * Allowed when:
 *   - `?.()` result is consumed by `??` / `||` / `&&` (caller is
 *     explicitly graceful-degrading).
 *   - The receiver is itself nullable: `getX?.()?.method?.()`.
 *   - Lodash memoize cache pattern: `fn.cache?.clear?.()`.
 *
 * Allow-comment exemption:
 *   // verify-optional-chain-on-required: allow (reason)
 * on the line preceding the suspect call.
 */
import { execSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const AUDIT = join(
  REPO_ROOT,
  'scripts/audit-silent-failures/03-optional-chain-on-required-binding.ts',
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
    if (/verify-optional-chain-on-required:\s*allow/.test(prev)) continue
    violations.push(f)
  }

  if (violations.length > 0) {
    console.error('verify-optional-chain-on-required: violations')
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} — ${v.snippet}`)
    }
    throw new Error(
      `${violations.length} optional-chain-on-required uses; either drop \`?.\`, ` +
        `make the contract field optional, or guard explicitly.`,
    )
  }
  console.log('verify-optional-chain-on-required: clean')
}

await main()
