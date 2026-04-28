#!/usr/bin/env bun
/**
 * Audit 10: type-cast escapes.
 *
 * Pattern: `as any` / `as unknown` / `as never`. Each is a deliberate
 * "shut up TypeScript". Sometimes necessary (FFI, dynamic dispatch),
 * usually a smell. Each cast can hide a real type mismatch.
 *
 * V7 codebase has known heavy `as any` usage from decompiled output.
 * Goal: count + locate, not auto-fix.
 */
import { emitJson, summarize, type Finding, type AuditResult } from './lib.js'
import { execSync } from 'child_process'

let raw = ''
try {
  raw = execSync(
    `grep -rEn 'as\\s+(any|unknown|never)\\b' packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=__tests__`,
    { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 },
  )
} catch {}

const findings: Finding[] = []
let total = 0
const counts = { any: 0, unknown: 0, never: 0 }

for (const ln of raw.split('\n')) {
  const m = ln.match(/^([^:]+):(\d+):(.*)$/)
  if (!m) continue
  total++
  const [_, file, lineStr, content] = m
  if (/^\s*(\/\/|\*|\/\*)/.test(content)) continue
  // Each `as X` on the line
  for (const cm of content.matchAll(/as\s+(any|unknown|never)\b/g)) {
    counts[cm[1] as 'any' | 'unknown' | 'never']++
    findings.push({
      pattern: 'type-cast-trap',
      file,
      line: parseInt(lineStr, 10),
      snippet: content.trim().slice(0, 140),
      severity: cm[1] === 'any' ? 'MEDIUM' : 'LOW',
      note: `\`as ${cm[1]}\` — type system bypass. Verify intent: is this a real escape (FFI, dynamic dispatch, decompiled boilerplate) or hiding a structural mismatch?`,
    })
  }
}

const result: AuditResult = {
  pattern: 'type-cast-trap',
  description: '`as any` / `as unknown` / `as never` — type system escapes that may hide real bugs',
  totalScanned: total,
  findings,
}

if (process.argv.includes('--summary')) {
  console.error(summarize(result))
  console.error(`  breakdown: any=${counts.any}, unknown=${counts.unknown}, never=${counts.never}`)
} else {
  emitJson(result)
}
