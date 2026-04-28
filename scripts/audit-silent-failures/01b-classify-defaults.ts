#!/usr/bin/env bun
/**
 * Audit 01b: classify each unwired setter slot's DEFAULT implementation.
 *
 * Three categories:
 *   - REAL: default body is the true implementation (e.g. `plural`).
 *           readers are not silently bugged; the slot is just unused
 *           ceremony. Safe to inline-import the function from _deps.ts
 *           directly, or leave as-is.
 *   - NOOP: default returns null/undefined/[]/{}/0/false/'' or empty
 *           function body. Readers ARE silently bugged.
 *           This is the real CRITICAL set.
 *   - UNCLEAR: heuristic can't tell; needs human review.
 */
import { readSafe, findFiles } from './lib.js'

const SLOT_DECL_RE =
  /^const\s+\[_get[A-Z]\w*,\s*set\w+Fn_\]\s*=\s*makeSetter\(([\s\S]+?)\)\s*$/
// also: `let _x: T = DEFAULT`
const LET_DECL_RE =
  /^let\s+_(\w+)\s*:\s*[^=]+=\s*([\s\S]+?)$/

interface Decl { setter: string; defaultExpr: string; file: string; line: number }

function findSlotDecls(): Decl[] {
  const files = findFiles('packages', '_deps.ts')
  const out: Decl[] = []
  for (const f of files) {
    const text = readSafe(f)
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      // makeSetter form
      let m = lines[i].match(/const\s+\[_get(\w+),\s*(set\w+Fn)_\]\s*=\s*makeSetter\(/)
      if (m) {
        // Body may span lines; greedy collect until closing `)\s*$`
        let body = lines[i]
        let depth = 0
        let started = false
        for (let j = i; j < Math.min(i + 20, lines.length); j++) {
          if (j > i) body += '\n' + lines[j]
          for (const ch of lines[j]) {
            if (ch === '(') { depth++; started = true }
            else if (ch === ')') {
              depth--
              if (started && depth === 0) {
                // We have the full makeSetter call.
                // Extract the inner expression
                const callMatch = body.match(/makeSetter\(([\s\S]+)\)\s*$/m)
                if (callMatch) {
                  out.push({
                    setter: m[2],
                    defaultExpr: callMatch[1].trim().slice(0, 400),
                    file: f,
                    line: i + 1,
                  })
                }
                break
              }
            }
          }
          if (started && depth === 0) break
        }
      }
      // Old-style `let _foo: T = ...`; match it specifically when followed by
      // `export function foo` or `export const foo` somewhere later.
      // Simpler: pattern-match the let line + read body if assigned a literal.
      m = lines[i].match(/^let\s+_(\w+)\s*:\s*[^=]+=\s*(.+?)$/)
      if (m && !lines[i].includes('makeSetter')) {
        // Find the corresponding `setXxxFn` later
        const candidate = m[1].charAt(0).toUpperCase() + m[1].slice(1)
        const setterRe = new RegExp(`(set${candidate}Fn|setGet${candidate}Fn)`)
        let setterName: string | null = null
        for (let j = i; j < Math.min(i + 30, lines.length); j++) {
          const sm = lines[j].match(/export\s+(?:function|const)\s+(set\w+Fn)/)
          if (sm && setterRe.test(sm[1])) { setterName = sm[1]; break }
        }
        if (setterName) {
          // Default expr = everything after `=` on this line; may continue
          let body = m[2]
          for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
            // continuation: indented or {
            if (/^\s*[}\]]\s*$/.test(lines[j]) || /^\s+/.test(lines[j])) {
              body += '\n' + lines[j]
            } else break
          }
          out.push({ setter: setterName, defaultExpr: body.trim().slice(0, 400), file: f, line: i + 1 })
        }
      }
    }
  }
  return out
}

function classify(expr: string): 'REAL' | 'NOOP' | 'UNCLEAR' {
  const stripped = expr
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .trim()
  // Match arrow / function default returns:
  // 1. `() => null`, `() => undefined`, `(...args) => null` etc.
  // 2. `(): X => []`, `(): X => {}`
  // 3. `async (...) => null`
  // 4. simple noop `() => {}`
  // 5. boolean / number safe defaults
  const noopBody = /=>\s*(null|undefined|\[\s*\]|\{\s*\}|0|false|true|""|''|`\s*`)\s*$/m
  const noopFn = /=>\s*\{\s*\}\s*$/m
  const noopAsync = /async[^=]*=>\s*(null|undefined|\[\s*\]|\{\s*\})/m
  if (noopBody.test(stripped) || noopFn.test(stripped) || noopAsync.test(stripped)) return 'NOOP'
  // Heuristic for REAL: body has more than just a return statement
  // i.e. multiple lines / function calls / control flow
  if (/\bif\s*\(|\bfor\s*\(|\bawait\s|\.\w+\(|\bnew\s+\w+/.test(stripped)) return 'REAL'
  // Pure literal function expression with non-trivial body
  if (/return\s+[^;]+[+\-*/&|]/.test(stripped)) return 'REAL'
  return 'UNCLEAR'
}

const decls = findSlotDecls()
const noop: Decl[] = []
const real: Decl[] = []
const unclear: Decl[] = []

for (const d of decls) {
  const c = classify(d.defaultExpr)
  if (c === 'NOOP') noop.push(d)
  else if (c === 'REAL') real.push(d)
  else unclear.push(d)
}

console.log(`Total slots: ${decls.length}`)
console.log(`NOOP    (true latent bugs): ${noop.length}`)
console.log(`REAL    (default is the actual impl): ${real.length}`)
console.log(`UNCLEAR (need review): ${unclear.length}`)

// Now intersect with the unwired list
const { execSync } = require('child_process')
const unwiredJson = execSync(
  `bun ${import.meta.dirname}/01-unwired-setter-slots.ts`,
  { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
)
const unwired = JSON.parse(unwiredJson)
const unwiredSetters = new Set(
  unwired.findings.map((f: { snippet: string }) => f.snippet.match(/set\w+Fn/)?.[0]).filter(Boolean),
)

console.log('\n=== Cross-product: unwired ∩ NOOP (true latent bugs) ===')
let trueBugs = 0
for (const d of noop) {
  if (unwiredSetters.has(d.setter)) {
    console.log(`  ${d.setter}  @ ${d.file}:${d.line}`)
    trueBugs++
  }
}
console.log(`\nTrue latent bug count: ${trueBugs}`)

console.log('\n=== Cross-product: unwired ∩ REAL (default is good — false alarm) ===')
let falseAlarms = 0
for (const d of real) {
  if (unwiredSetters.has(d.setter)) {
    falseAlarms++
  }
}
console.log(`False alarm count: ${falseAlarms}`)

console.log('\n=== Cross-product: unwired ∩ UNCLEAR ===')
let unclearCount = 0
for (const d of unclear) {
  if (unwiredSetters.has(d.setter)) {
    console.log(`  ${d.setter}  @ ${d.file}:${d.line}`)
    console.log(`    default: ${d.defaultExpr.slice(0, 120)}`)
    unclearCount++
  }
}
console.log(`\nUnclear count: ${unclearCount}`)
