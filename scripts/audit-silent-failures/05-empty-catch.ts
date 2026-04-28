#!/usr/bin/env bun
/**
 * Audit 05: empty catch blocks.
 *
 * Pattern: `try { ... } catch {}` or `catch (e) {}` with body that does
 * NOTHING. Every exception is silently swallowed. Often legitimate
 * (e.g. cleanup that may fail, fire-and-forget log write), but every
 * one is a candidate for "real bug hidden by silent swallow".
 *
 * Detection: walk forward from `catch` to balance braces; check whether
 * the body has any non-whitespace, non-comment content.
 *
 * Findings are LOW by default (most are intentional fallbacks); the
 * triage step will promote actual bugs.
 */
import { readSafe, emitJson, summarize, type Finding, type AuditResult } from './lib.js'
import { execSync } from 'child_process'

let raw = ''
try {
  // Find every "catch" line and its file/line.
  raw = execSync(
    `grep -rEn '\\}\\s*catch' packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules`,
    { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 },
  )
} catch {}

const findings: Finding[] = []
let total = 0

// For each match, read enough context (next 5 lines) to decide if catch body is empty.
const fileCache = new Map<string, string[]>()
function lines(file: string): string[] {
  if (!fileCache.has(file)) {
    fileCache.set(file, readSafe(file).split('\n'))
  }
  return fileCache.get(file)!
}

for (const ln of raw.split('\n')) {
  const m = ln.match(/^([^:]+):(\d+):(.*)$/)
  if (!m) continue
  total++
  const [_, file, lineStr, content] = m
  const lineNum = parseInt(lineStr, 10)
  if (file.includes('/__tests__/') || file.startsWith('tests/')) continue
  if (/^\s*(\/\/|\*|\/\*)/.test(content)) continue

  // The catch keyword may end on this line with `{` on next line, or all
  // inline. Walk forward up to 6 lines to see whether the catch body has
  // any non-whitespace, non-comment content before its `}`.
  const fileLines = lines(file)
  // Find the opening { of the catch block
  let i = lineNum - 1
  let openBraceLine = -1
  for (let j = i; j < Math.min(i + 4, fileLines.length); j++) {
    if (/catch[^{]*\{/.test(fileLines[j])) { openBraceLine = j; break }
  }
  if (openBraceLine === -1) continue

  // Walk forward, look for non-trivial content before matching close brace.
  let depth = 0
  let started = false
  let body = ''
  let bodyEndLine = -1
  outer:
  for (let j = openBraceLine; j < Math.min(openBraceLine + 30, fileLines.length); j++) {
    const text = fileLines[j]
    for (let c = 0; c < text.length; c++) {
      if (text[c] === '{') { depth++; started = true; continue }
      if (text[c] === '}') {
        depth--
        if (started && depth === 0) {
          // We've hit the matching close brace.
          // Body content = everything between the first `{` and the last `}`.
          bodyEndLine = j
          break outer
        }
        continue
      }
      if (started && depth > 0) {
        body += text[c]
      }
    }
    body += '\n'
  }
  if (bodyEndLine === -1) continue

  // Strip comments and whitespace from body
  const stripped = body
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .trim()

  if (stripped === '') {
    findings.push({
      pattern: 'empty-catch',
      file,
      line: lineNum,
      snippet: content.trim().slice(0, 120),
      severity: 'LOW',
      note: `Empty catch block — every exception silently swallowed. If this is intentional, add a single-line comment explaining why. If not, log the error or rethrow.`,
    })
  }
}

const result: AuditResult = {
  pattern: 'empty-catch',
  description: 'try { ... } catch {} with empty body — exceptions swallowed silently',
  totalScanned: total,
  findings,
}

if (process.argv.includes('--summary')) {
  console.error(summarize(result))
} else {
  emitJson(result)
}
