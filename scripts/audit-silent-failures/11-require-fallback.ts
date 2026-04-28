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

  // Read catch body — start scanning AFTER the catch keyword on
  // the catchOpen line. The line typically looks like `} catch (e) {`,
  // where the leading `}` closes the try block (must not affect depth)
  // and the trailing `{` opens the catch body. Naïve depth-tracking
  // counts the leading `}` as a close, sending depth negative and
  // making the body extraction skip the whole catch — which used to
  // produce false positives by treating non-empty catches as empty.
  let depth = 0, started = false, body = ''
  // Find `catch ... {` on the catchOpen line and start char-scan after the `{`.
  const startIdx = (() => {
    const m = /\bcatch\b/.exec(fileLines[catchOpen])
    if (!m) return 0
    const after = fileLines[catchOpen].indexOf('{', m.index)
    return after >= 0 ? after : fileLines[catchOpen].length
  })()
  for (let j = catchOpen; j < Math.min(catchOpen + 16, fileLines.length); j++) {
    const t = fileLines[j]
    const start = j === catchOpen ? startIdx : 0
    for (let c = start; c < t.length; c++) {
      const ch = t[c]
      if (ch === '{') { depth++; started = true; continue }
      if (ch === '}') {
        depth--
        if (started && depth === 0) break
        continue
      }
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
    // File-level escape hatch: top-of-module docstring documenting the
    // require-fallback pattern. Avoids flagging high-frequency host-binding
    // adapter files where every wire is a try/require/catch by design.
    const head = fileLines.slice(0, 30).join('\n')
    const fileLevelExempt =
      /require[ -]?fallback(s)?|optional[ -]?dep|feature[ -]?gated|by[ -]?design.*require|host[ -]?binding[ -]?adapter|extra host bindings|platform[ -]?(conditional|dispatch)|backend[ -]?(dispatch|loader)|native[ -]?module|napi/i.test(
        head,
      )
    if (fileLevelExempt) continue
    // Per-line escape: `// optional` or `// feature-gated` etc. on or
    // anywhere in the 5 lines preceding the require call. The comment
    // commonly lives just above the require, especially when the
    // require expression itself wraps onto a new line.
    const nearby = fileLines
      .slice(Math.max(0, lineNum - 6), lineNum + 1)
      .join('\n')
    if (/\/\/.*(optional|feature-gated|fallback|missing-ok|optional[ -]?dep)/i.test(nearby)) continue
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
