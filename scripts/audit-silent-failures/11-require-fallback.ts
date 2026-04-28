#!/usr/bin/env bun
/**
 * Audit 11: require() with try/catch fallback to fake stub.
 *
 * Pattern:
 *   try { return require('@x/y').foo } catch { return null }
 *   try { return require('@x/y').foo } catch { return [] }
 *   try { ... require ... } catch { // feature off; return safe default
 *     return null
 *   }
 *
 * If `@x/y` doesn't exist or throws at load, the catch silently returns
 * a safe default. Fine for "feature gated by build flag" cases (DAEMON,
 * BG_SESSIONS); dangerous when require points at a real path that should
 * always exist but happens to break.
 *
 * Detection: catch blocks whose preceding try contains a `require(` call,
 * AND the catch body is a single return X / nothing.
 */
import { emitJson, summarize, type Finding, type AuditResult, readSafe } from './lib.js'
import { execSync } from 'child_process'

let raw = ''
try {
  raw = execSync(
    `grep -rEn 'require\\(' packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules --exclude-dir=__tests__`,
    { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 },
  )
} catch {}

const findings: Finding[] = []
let total = 0

const fileCache = new Map<string, string[]>()
function lines(file: string): string[] {
  if (!fileCache.has(file)) fileCache.set(file, readSafe(file).split('\n'))
  return fileCache.get(file)!
}

for (const ln of raw.split('\n')) {
  const m = ln.match(/^([^:]+):(\d+):(.*)$/)
  if (!m) continue
  total++
  const [_, file, lineStr, content] = m
  if (/^\s*(\/\/|\*|\/\*)/.test(content)) continue
  // Skip pure declaration: `const fs = require('node:fs')` (top-level static)
  // We only care about require() inside a try/catch.
  const lineNum = parseInt(lineStr, 10)
  const fileLines = lines(file)
  // Walk backward up to 10 lines looking for `try {` or `try`
  let inTry = false
  for (let j = lineNum - 1; j >= Math.max(0, lineNum - 10); j--) {
    if (/\btry\s*\{/.test(fileLines[j])) { inTry = true; break }
    if (/^\s*function\s|^\s*export/.test(fileLines[j])) break
  }
  if (!inTry) continue

  // Look forward for `} catch` and check what's in the body.
  let catchOpen = -1
  for (let j = lineNum; j < Math.min(lineNum + 30, fileLines.length); j++) {
    if (/\}\s*catch[\s(]/.test(fileLines[j])) { catchOpen = j; break }
  }
  if (catchOpen === -1) continue

  // Read catch body (next ~6 lines or until close brace at same depth)
  let depth = 0, started = false, body = ''
  for (let j = catchOpen; j < Math.min(catchOpen + 8, fileLines.length); j++) {
    const t = fileLines[j]
    for (const ch of t) {
      if (ch === '{') { depth++; started = true; continue }
      if (ch === '}') { depth--; if (started && depth === 0) break }
      if (started && depth > 0) body += ch
    }
    body += '\n'
    if (started && depth === 0) break
  }
  const stripped = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .trim()
  // Match `return null`, `return []`, `return {}`, etc., or empty
  if (
    stripped === '' ||
    /^return\s+(null|undefined|\[\s*\]|\{\s*\}|0|false|true|""|''|`\s*`)\s*;?$/.test(stripped)
  ) {
    findings.push({
      pattern: 'require-fallback-to-stub',
      file,
      line: lineNum,
      snippet: content.trim().slice(0, 140),
      severity: 'MEDIUM',
      note: `require() inside try/catch with safe-default fallback. If the require target is missing or broken, the call silently returns the default. Verify the require path resolves under all build configs; if it's intentionally feature-gated, document why.`,
    })
  }
}

const result: AuditResult = {
  pattern: 'require-fallback-to-stub',
  description: 'try { require(X) } catch { return null/[] } — module load failures masked',
  totalScanned: total,
  findings,
}

if (process.argv.includes('--summary')) {
  console.error(summarize(result))
} else {
  emitJson(result)
}
