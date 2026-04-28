#!/usr/bin/env bun
/**
 * Audit 07: stub functions whose body is only `return null/[]/{}/0/undefined`.
 *
 * Pattern: function declared with a meaningful name (suggests it should
 * do something) but body is one return statement returning a safe
 * default. Often the leftovers of V7 "declared the slot, never wired
 * the impl" or feature-flag-disabled stub paths.
 *
 * Detection: walk every file, find function declarations, brace-balance
 * to find body, check if body is just `return X` (where X is a safe
 * default literal).
 */
import { emitJson, summarize, type Finding, type AuditResult, findFiles } from './lib.js'
import { readSafe } from './lib.js'
import { execSync } from 'child_process'

const SAFE_DEFAULT_RE =
  /^\s*return\s+(null|undefined|\[\s*\]|\{\s*\}|0|false|true|""|''|`\s*`)\s*;?\s*$/

let allTsFiles: string[] = []
try {
  allTsFiles = execSync(
    `find packages -type f \\( -name '*.ts' -o -name '*.tsx' \\) -not -path '*/node_modules/*' -not -path '*/__tests__/*' -not -path '*/testing/*' -not -name '_deps.ts'`,
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean)
} catch {}

const findings: Finding[] = []
let total = 0

for (const file of allTsFiles) {
  const text = readSafe(file)
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    // Match function declaration / arrow that has `{` on this line.
    // `function NAME(...) {` or `const NAME = (...) => {`
    const declMatch = lines[i].match(/^(\s*)(?:export\s+)?(?:async\s+)?(?:function\s*\*?\s*(\w+)\s*\([^)]*\)(?:\s*:\s*[^={]+)?|const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)(?:\s*:\s*[^={=]+)?\s*=>)\s*\{/)
    if (!declMatch) continue
    const fnName = declMatch[2] ?? declMatch[3]
    if (!fnName) continue
    total++
    // Brace-balance to find matching `}`
    let depth = 0
    let started = false
    let endLine = -1
    let bodyLines: string[] = []
    for (let j = i; j < Math.min(i + 60, lines.length); j++) {
      const text = lines[j]
      for (const ch of text) {
        if (ch === '{') { depth++; started = true; continue }
        if (ch === '}') {
          depth--
          if (started && depth === 0) {
            endLine = j
            break
          }
        }
      }
      if (j > i) bodyLines.push(text)
      if (endLine !== -1) break
    }
    if (endLine === -1) continue
    if (endLine - i > 6) continue  // skip larger fns; we want stubs

    // Check if body has only a `return X` after stripping comments/whitespace
    const body = bodyLines.join('\n').replace(/\}$/, '')  // strip trailing }
    const stripped = body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .trim()
    if (!stripped) continue

    // The body should be a single `return ...` line (semicolon optional).
    if (SAFE_DEFAULT_RE.test(stripped)) {
      findings.push({
        pattern: 'stub-return-only',
        file,
        line: i + 1,
        snippet: `${fnName}() { ${stripped.slice(0, 80)} }`,
        severity: 'LOW',
        note: `Function ${fnName} body is just \`${stripped}\`. May be intentional (placeholder, feature-flag stub) or leftover from V7 setter-pattern wires that never got real impl. Verify caller expectations.`,
      })
    }
  }
}

const result: AuditResult = {
  pattern: 'stub-return-only',
  description: 'Functions whose body is just `return null/[]/{}/0/false/undefined`',
  totalScanned: total,
  findings,
}

if (process.argv.includes('--summary')) {
  console.error(summarize(result))
} else {
  emitJson(result)
}
