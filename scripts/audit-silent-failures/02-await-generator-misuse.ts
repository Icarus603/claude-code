#!/usr/bin/env bun
/**
 * Audit 02: await on AsyncGenerator misuse.
 *
 * Pattern: `const x = await foo(...)` where `foo` is declared
 * `async function* foo()` or yields. await on the call expression
 * gets the AsyncGenerator object back, NOT the return value;
 * iterator body never runs. Real fix: `for await ... of foo()` or
 * manual `.next()` drain.
 *
 * This was the bug class behind HookDepImpl.onStop (commit 8858c83d).
 *
 * Detection strategy (no full AST yet — use Bun's regex on text):
 *   1. Find every `async function* NAME` declaration (or arrow form).
 *   2. For each NAME, find `await NAME(` callsites.
 *   3. Skip if the line is `await NAME(...).next()` or `for await`.
 *
 * Approximation: cross-package generator usage where caller imports
 * NAME from another package isn't tracked symbol-precisely; we go by
 * name match. False positives possible if a package exports a regular
 * async fn under the same name elsewhere. Acceptable for inventory.
 */
import { findFiles, readSafe, emitJson, summarize, type Finding, type AuditResult } from './lib.js'
import { execSync } from 'child_process'

// 1. find every async function* NAME (declaration form).
//    Returns Map<name, owningFile> for shadow detection.
function listGeneratorFunctions(): Map<string, string[]> {
  let raw = ''
  try {
    raw = execSync(
      `grep -rEn 'async\\s+function\\s*\\*\\s*\\w+|export\\s+(async\\s+)?function\\s*\\*\\s*\\w+' packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules`,
      { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
    )
  } catch {}
  const names = new Map<string, string[]>()
  for (const ln of raw.split('\n')) {
    const lm = ln.match(/^([^:]+):\d+:(.*)$/)
    if (!lm) continue
    const m = lm[2].match(/function\s*\*\s*(\w+)/)
    if (!m) continue
    if (!names.has(m[1])) names.set(m[1], [])
    names.get(m[1])!.push(lm[1])
  }
  return names
}

// Detect if a name has a non-generator alias defined in the same file
// (the local-shadow false-positive case, like bridge's local withRetry).
function hasLocalShadow(name: string, file: string): boolean {
  let raw = ''
  try {
    raw = execSync(
      `grep -E '(export\\s+)?(async\\s+)?function\\s+${name}\\b|(export\\s+)?const\\s+${name}\\s*=' '${file}'`,
      { encoding: 'utf8' },
    )
  } catch {}
  return raw.split('\n').some(l => l && !/function\s*\*/.test(l))
}

// 2. for each generator name, find suspicious `await NAME(` callsites.
function findAwaitCallsites(name: string): Array<{ file: string; line: number; content: string }> {
  let raw = ''
  try {
    raw = execSync(
      `grep -rEn '\\bawait\\s+${name}\\s*\\(' packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules`,
      { encoding: 'utf8' },
    )
  } catch {}
  const out: Array<{ file: string; line: number; content: string }> = []
  for (const ln of raw.split('\n')) {
    const m = ln.match(/^([^:]+):(\d+):(.*)$/)
    if (!m) continue
    const content = m[3]
    // Filter out clear correct usage:
    //   - for await (... of NAME(...))
    //   - await NAME(...).next()
    //   - await NAME(...).return / .throw
    //   - typeof check
    if (/for\s+await\s+\(/.test(content)) continue
    if (new RegExp(`await\\s+${name}\\s*\\([^)]*\\)\\.next\\(`).test(content)) continue
    if (new RegExp(`await\\s+${name}\\s*\\([^)]*\\)\\.(return|throw)\\b`).test(content)) continue
    if (/typeof\s+/.test(content)) continue
    // Skip comment-line false positives
    if (/^\s*(\/\/|\*|\/\*)/.test(content)) continue
    if (/^\s*\*\s/.test(content)) continue  // jsdoc continuation
    out.push({ file: m[1], line: parseInt(m[2], 10), content })
  }
  return out
}

const generatorNames = listGeneratorFunctions()

const findings: Finding[] = []
for (const [name, _] of generatorNames) {
  const sites = findAwaitCallsites(name)
  for (const s of sites) {
    if (hasLocalShadow(name, s.file)) {
      // Same-file non-generator definition wins via local scope.
      // Real verification needs symbol resolution; flag as MEDIUM.
      findings.push({
        pattern: 'await-generator-misuse',
        file: s.file,
        line: s.line,
        snippet: s.content.trim().slice(0, 120),
        severity: 'MEDIUM',
        note: `\`await ${name}(...)\` matches a generator name elsewhere in repo, but the same file defines a local non-generator ${name}. Likely a false positive (local scope wins). Verify which one is bound.`,
      })
      continue
    }
    findings.push({
      pattern: 'await-generator-misuse',
      file: s.file,
      line: s.line,
      snippet: s.content.trim().slice(0, 120),
      severity: 'CRITICAL',
      note: `\`await ${name}(...)\` — but ${name} is declared async function*. Body never runs; result is the generator object. Use \`for await ... of\` or manual .next() drain.`,
    })
  }
}

const result: AuditResult = {
  pattern: 'await-generator-misuse',
  description: 'await on async function* (generator body never iterates)',
  totalScanned: generatorNames.size,
  findings,
}

if (process.argv.includes('--summary')) {
  console.error(summarize(result))
} else {
  emitJson(result)
}
