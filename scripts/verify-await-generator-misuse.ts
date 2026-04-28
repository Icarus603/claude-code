#!/usr/bin/env bun
/**
 * verify-await-generator-misuse — `await asyncFunctionStar()` is forbidden.
 *
 * `async function*` is an AsyncGenerator. `await` on the call expression
 * yields the generator object itself, NOT a value; the body never runs.
 * The HookDepImpl.onStop bug (commit 8858c83d) was exactly this pattern,
 * silently broken on the headless `-p` path since V7 day one.
 *
 * Detection delegates to scripts/audit-silent-failures/02-await-generator-misuse.ts.
 * This verifier just runs the audit and fails on any finding.
 *
 * To intentionally bypass (e.g. for a same-name local shadow that the
 * audit's hasLocalShadow filter doesn't catch), add the comment
 *   // verify-await-generator-misuse: allow (reason)
 * on the line immediately preceding the suspect `await ...()` call.
 */
import { execSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const AUDIT = join(REPO_ROOT, 'scripts/audit-silent-failures/02-await-generator-misuse.ts')

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
    if (/verify-await-generator-misuse:\s*allow/.test(prev)) continue
    violations.push(f)
  }

  if (violations.length > 0) {
    console.error('verify-await-generator-misuse: violations')
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} — ${v.snippet}`)
    }
    throw new Error(
      `${violations.length} await-generator misuses; iterate with for await or .next() instead.`,
    )
  }
  console.log(
    `verify-await-generator-misuse: clean`,
  )
}

await main()
