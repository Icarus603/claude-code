#!/usr/bin/env bun
/**
 * Audit 09: optional contract methods used as if guaranteed.
 *
 * Pattern: contract has `method?: () => T`, caller does
 * `binding.method?.()` then immediately uses the result as if it's T
 * (not T | undefined). The TypeScript optional return is silently
 * ignored at runtime when the method is missing.
 *
 * Example bad pattern:
 *   const x = bindings.foo?.()   // x is T | undefined
 *   x.bar()                      // crashes if foo wasn't installed
 *
 * Detection (text-based):
 *   1. Find `.method?.(`
 *   2. Same line or next line, look for `<varName>.X` or `(<varName>)`
 *      that uses the result as a non-optional value.
 *
 * Lower precision than audit 03 (optional chain on REQUIRED), but this
 * targets a different bug: declared optional yet used as required.
 */
import { emitJson, summarize, type Finding, type AuditResult, readSafe } from './lib.js'
import { execSync } from 'child_process'

let raw = ''
try {
  raw = execSync(
    `grep -rEn 'const\\s+\\w+\\s*=\\s*\\w+\\?\\.\\(' packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules`,
    { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 },
  )
} catch {}

const findings: Finding[] = []
let total = 0

const fileCache = new Map<string, string[]>()
function getLines(file: string): string[] {
  if (!fileCache.has(file)) fileCache.set(file, readSafe(file).split('\n'))
  return fileCache.get(file)!
}

for (const ln of raw.split('\n')) {
  const m = ln.match(/^([^:]+):(\d+):(.*)$/)
  if (!m) continue
  total++
  const [_, file, lineStr, content] = m
  if (file.includes('/__tests__/')) continue
  if (/^\s*(\/\/|\*|\/\*)/.test(content)) continue

  // Extract `const VAR = ...?.(`
  const decl = content.match(/const\s+(\w+)\s*=\s*(\w+(?:\.\w+)*)\?\.\(/)
  if (!decl) continue
  const varName = decl[1]
  const lineNum = parseInt(lineStr, 10)

  // Look ahead 5 lines for `varName.X(` (method call) or `varName.X` (deref)
  // without `?` or `if (varName)` guard.
  const fileLines = getLines(file)
  let usedUnchecked = false
  let usageContent = ''
  for (let i = lineNum; i < Math.min(lineNum + 8, fileLines.length); i++) {
    const ahead = fileLines[i]
    // Skip the guard pattern itself
    if (new RegExp(`if\\s*\\(\\s*!?${varName}\\b`).test(ahead)) break
    if (new RegExp(`${varName}\\s*===\\s*(undefined|null)`).test(ahead)) break
    if (new RegExp(`${varName}\\s*\\?\\?`).test(ahead)) break  // ?? guard
    // Detect deref without ?.
    if (new RegExp(`\\b${varName}\\.\\w+`).test(ahead) &&
        !new RegExp(`\\b${varName}\\?\\.\\w+`).test(ahead)) {
      usedUnchecked = true
      usageContent = ahead.trim().slice(0, 120)
      break
    }
  }
  if (usedUnchecked) {
    findings.push({
      pattern: 'optional-method-no-guard',
      file,
      line: lineNum,
      snippet: `${content.trim().slice(0, 80)} → ${usageContent}`,
      severity: 'HIGH',
      note: `${varName} comes from \`?.()\` but is dereferenced without null-check on the next line(s). If the optional method is missing, this throws "Cannot read properties of undefined" — silent until that path triggers.`,
    })
  }
}

const result: AuditResult = {
  pattern: 'optional-method-no-guard',
  description: 'Result of ?.() used unchecked — crashes when binding missing',
  totalScanned: total,
  findings,
}

if (process.argv.includes('--summary')) {
  console.error(summarize(result))
} else {
  emitJson(result)
}
