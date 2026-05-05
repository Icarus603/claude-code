#!/usr/bin/env bun
/**
 * verify-type-import-runtime-use — `import type { X }` followed by `new X(...)`
 * or `class … extends X` is forbidden.
 *
 * `import type` is erased at build time. Constructing or extending the symbol
 * at runtime throws `ReferenceError: X is not defined`. When the throw lands
 * inside an EventEmitter listener (packages/@ant/ink/src/core/events/emitter.ts)
 * or inside App.tsx's handleReadable try/catch, the error is swallowed and the
 * UI silently freezes — the exact bug fixed in commit 4b7764e3 where the
 * ctrl+r history-search picker stopped responding to keystrokes.
 *
 * To intentionally bypass (e.g. when a destructured local binding shadows the
 * type-only import — see packages/provider/src/anthropic/client.ts:218 + 265),
 * add the comment
 *   // verify-type-import-runtime-use: allow (reason)
 * on the line immediately preceding the offending `new X(...)` or
 * `class … extends X` line.
 */
import { Glob } from 'bun'
import { readFile } from 'node:fs/promises'

const TYPE_BLOCK_RE = /^import\s+type\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gm
const MIXED_RE = /^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gm

interface Violation {
  file: string
  line: number
  symbol: string
  importedFrom: string
  snippet: string
}

function stripComments(src: string): string {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  out = out
    .split('\n')
    .map(line => {
      const idx = line.indexOf('//')
      if (idx === -1) return line
      const before = line.slice(0, idx)
      const sq = (before.match(/'/g) || []).length
      const dq = (before.match(/"/g) || []).length
      const bt = (before.match(/`/g) || []).length
      if (sq % 2 === 1 || dq % 2 === 1 || bt % 2 === 1) return line
      return before
    })
    .join('\n')
  return out
}

function collectTypeOnlyImports(src: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of src.matchAll(TYPE_BLOCK_RE)) {
    const mod = m[2]!
    for (const raw of m[1]!.split(',')) {
      const part = raw.trim()
      if (!part) continue
      const localName = part.replace(/.*\s+as\s+/, '').trim()
      out.set(localName, mod)
    }
  }
  for (const m of src.matchAll(MIXED_RE)) {
    const mod = m[2]!
    for (const raw of m[1]!.split(',')) {
      const part = raw.trim()
      if (!part.startsWith('type ')) continue
      const localName = part.slice(5).trim().replace(/.*\s+as\s+/, '').trim()
      out.set(localName, mod)
    }
  }
  return out
}

function hasLocalShadow(codeSrc: string, symbol: string, beforeLine: number): boolean {
  // Did a runtime declaration of `symbol` precede the offending line? If so,
  // the type-only import is shadowed and the construction is safe.
  //
  // Cheap heuristic: any destructuring pattern `{ symbol }` or `{ symbol:`
  // appearing on the LHS of an `=` (in const/let/var) before the line.
  // This deliberately over-accepts to avoid false positives in real code
  // like `const [{ GoogleAuth }] = await Promise.all(...)`.
  const head = codeSrc.split('\n').slice(0, beforeLine - 1).join('\n')
  const escaped = symbol.replace(/[$]/g, '\\$')

  // Direct `const X = ...`, `function X`, `class X`
  if (new RegExp(`(?:const|let|var)\\s+${escaped}\\s*=`).test(head)) return true
  if (new RegExp(`\\b(?:function\\*?|class)\\s+${escaped}\\b`).test(head)) return true

  // Destructuring assignment: any `{ ... X ... }` paired with an `=` after it,
  // inside a const/let/var statement. We scan each `(const|let|var) ... =`
  // statement and check if `X` (as bare identifier or `X:` shorthand) appears
  // in the LHS pattern. This handles array+object nested destructuring.
  const stmtRe = /(?:const|let|var)\s+([\s\S]*?)=/g
  for (const m of head.matchAll(stmtRe)) {
    const lhs = m[1]!
    const idRe = new RegExp(`\\b${escaped}\\b(?!\\s*:\\s*\\w)`)
    const aliasOutRe = new RegExp(`:\\s*${escaped}\\b`) // { Other: X }
    if (idRe.test(lhs) || aliasOutRe.test(lhs)) return true
  }

  // Value import of same name (not `import type`, not `{ type X }`)
  const importRe = /^import\s*\{([^}]+)\}\s*from/gm
  for (const m of head.matchAll(importRe)) {
    const list = m[1]!
    for (const raw of list.split(',')) {
      const part = raw.trim()
      if (!part) continue
      if (part.startsWith('type ')) continue
      const local = part.replace(/.*\s+as\s+/, '').trim()
      if (local === symbol) return true
    }
  }

  return false
}

async function main(): Promise<void> {
  const glob = new Glob('packages/**/*.{ts,tsx}')
  const files = (await Array.fromAsync(glob.scan('.'))).filter(
    f => !f.includes('node_modules') && !f.endsWith('.d.ts'),
  )

  const violations: Violation[] = []

  for (const file of files) {
    const rawSrc = await readFile(file, 'utf8')
    const typeOnly = collectTypeOnlyImports(rawSrc)
    if (typeOnly.size === 0) continue

    const codeSrc = stripComments(rawSrc)
    const codeLines = codeSrc.split('\n')
    const rawLines = rawSrc.split('\n')

    for (const [symbol, mod] of typeOnly) {
      const escaped = symbol.replace(/[$]/g, '\\$')
      const newRe = new RegExp(`\\bnew\\s+${escaped}\\b`)
      const classExtRe = new RegExp(
        `\\bclass\\s+\\w+(?:<[^>]*>)?\\s+extends\\s+${escaped}\\b`,
      )

      for (let i = 0; i < codeLines.length; i++) {
        const line = codeLines[i]!
        if (/^\s*import\b/.test(line)) continue
        if (!newRe.test(line) && !classExtRe.test(line)) continue

        // Allow comment opt-out
        const prev = rawLines[i - 1] ?? ''
        if (/verify-type-import-runtime-use:\s*allow/.test(prev)) continue

        // Skip when a runtime binding shadows the type-only import before this line
        if (hasLocalShadow(codeSrc, symbol, i + 1)) continue

        violations.push({
          file,
          line: i + 1,
          symbol,
          importedFrom: mod,
          snippet: rawLines[i]!.trim(),
        })
      }
    }
  }

  if (violations.length > 0) {
    console.error('verify-type-import-runtime-use: violations')
    for (const v of violations) {
      console.error(
        `  ${v.file}:${v.line}  [type-only ${v.symbol} from '${v.importedFrom}']`,
      )
      console.error(`    ${v.snippet}`)
    }
    throw new Error(
      `${violations.length} type-only imports used at runtime — change to value import or add // verify-type-import-runtime-use: allow (reason).`,
    )
  }

  console.log('verify-type-import-runtime-use: OK')
}

await main()
