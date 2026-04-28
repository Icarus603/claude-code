#!/usr/bin/env bun
/**
 * verify-optional-method-no-guard — values from `?.()` may not be
 * dereferenced unchecked.
 *
 * Pattern: `const x = obj?.method?.()` followed (within 8 lines) by
 * `x.foo` without a null/undefined guard. If the optional method is
 * missing, `x` is undefined and `.foo` throws — silent until that
 * code path runs.
 *
 * Allowed when:
 *   - The decl line itself has `?? default` (chain completes with
 *     fallback so x is non-undefined at use sites).
 *   - An `if (!x)` / `x === undefined` / `x ?? ...` guard appears
 *     before the deref.
 *
 * Allow-comment exemption:
 *   // verify-optional-method-no-guard: allow (reason)
 */
import { execSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const AUDIT = join(
  REPO_ROOT,
  'scripts/audit-silent-failures/09-optional-method-no-guard.ts',
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
    if (/verify-optional-method-no-guard:\s*allow/.test(prev)) continue
    violations.push(f)
  }

  if (violations.length > 0) {
    console.error('verify-optional-method-no-guard: violations')
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} — ${v.snippet}`)
    }
    throw new Error(
      `${violations.length} unguarded uses of \`?.()\` results; add \`?? default\` ` +
        `at the decl, or null-check before the deref.`,
    )
  }
  console.log('verify-optional-method-no-guard: clean')
}

await main()
