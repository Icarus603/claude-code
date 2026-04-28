#!/usr/bin/env bun
/**
 * Audit 12: module-level state declared as `null` with implicit "someone
 * will initialize me" assumption.
 *
 * Pattern:
 *   let x: SomeType | null = null
 *   export function getX() { return x }
 *   export function setX(v: SomeType) { x = v }
 *
 * If `setX` is never called, every consumer of `getX()` gets null.
 * Same disease class as the unwired setter slot, just without the
 * `_deps.ts` ceremony.
 *
 * Detection:
 *   1. Find module-level `let NAME: TYPE | null = null` declarations.
 *   2. For each, check if any setter to it exists in the same file
 *      (`NAME = ...`) AND that setter is exported / called from outside.
 *   3. Flag if no external write site is found.
 */
import { emitJson, summarize, type Finding, type AuditResult, readSafe } from './lib.js'
import { execSync } from 'child_process'

let allFiles: string[] = []
try {
  allFiles = execSync(
    `find packages -type f \\( -name '*.ts' -o -name '*.tsx' \\) -not -path '*/node_modules/*' -not -path '*/__tests__/*' -not -path '*/testing/*'`,
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean)
} catch {}

const findings: Finding[] = []
let total = 0

for (const file of allFiles) {
  const text = readSafe(file)
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    // Module-level `let NAME: TYPE | null = null` (heuristic: starts at col 0)
    const m = lines[i].match(/^let\s+(_?\w+)\s*:\s*[^=]+\|\s*null\s*=\s*null\s*$/)
    if (!m) continue
    total++
    const varName = m[1]

    // Look for setters: `NAME = ` lines in same file (excluding the decl)
    let writeSites = 0
    for (let j = 0; j < lines.length; j++) {
      if (j === i) continue
      const re = new RegExp(`^\\s*${varName}\\s*=\\s*[^=]`)
      if (re.test(lines[j])) writeSites++
    }
    if (writeSites > 0) continue  // someone writes it; OK

    findings.push({
      pattern: 'module-level-null-state',
      file,
      line: i + 1,
      snippet: lines[i].trim().slice(0, 120),
      severity: 'MEDIUM',
      note: `Module-level let ${varName} initialized to null with no write site in this file. Consumers of ${varName} will see null forever unless an external setter (likely via host bindings) is called. Verify the writer side actually runs at startup.`,
    })
  }
}

const result: AuditResult = {
  pattern: 'module-level-null-state',
  description: 'let NAME: T | null = null at module level with no in-file writer',
  totalScanned: total,
  findings,
}

if (process.argv.includes('--summary')) {
  console.error(summarize(result))
} else {
  emitJson(result)
}
