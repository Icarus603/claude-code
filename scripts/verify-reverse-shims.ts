#!/usr/bin/env bun
/**
 * verify-reverse-shims — detect packages/X that re-export from src/.
 *
 * V7 §3.1 (Owner Over Shim): "shim, wrapper, host binding, compat facade
 * is not owner. There is no package owner if the implementation lives in
 * src/. The package only counts if implementation ownership transferred."
 *
 * Pattern: `export * from 'src/...'` or `export type * from 'src/...'`
 * inside any packages/ file. This is the inverse of a forward shim
 * (which is acceptable: src/X = export * from packages/Y).
 *
 * Usage: bun run scripts/verify-reverse-shims.ts
 */

import { readFile } from 'fs/promises'

const PATTERNS = [
  /export\s+(?:type\s+)?\*\s+from\s+['"]src\//g,
  /export\s+\{[^}]*\}\s+from\s+['"]src\//g,
]

async function collectFiles(): Promise<string[]> {
  const proc = Bun.spawn([
    'find', 'packages', '-type', 'f',
    '(', '-name', '*.ts', '-o', '-name', '*.tsx', ')',
    '-not', '-path', '*/node_modules/*',
    '-not', '-path', '*/dist/*',
    '-not', '-path', '*/__tests__/*',
  ], { stdout: 'pipe' })
  const out = await new Response(proc.stdout).text()
  return out.split('\n').map(s => s.trim()).filter(Boolean)
}

function stripComments(s: string): string {
  // Strip // line comments and /* */ block comments — they sometimes contain
  // example imports that look like real exports to the regex.
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""') // crude string-strip
}

async function main() {
  const files = await collectFiles()
  const violations: Array<{ file: string; canonical: string }> = []

  for (const f of files) {
    let content: string
    try { content = await readFile(f, 'utf8') } catch { continue }
    const stripped = stripComments(content)
    // Re-scan stripped content but report against original — actually the
    // regex needs the original quote chars; scan original but skip comment
    // lines by checking the line context.
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const trimmed = line.trim()
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue
      for (const pat of PATTERNS) {
        pat.lastIndex = 0
        const m = pat.exec(line)
        if (!m) continue
        const idx = line.indexOf("'src/", m.index)
        if (idx < 0) continue
        const end = line.indexOf("'", idx + 1)
        const canonical = line.slice(idx + 1, end > idx ? end : idx + 60)
        violations.push({ file: f, canonical })
      }
    }
  }

  if (violations.length === 0) {
    console.log('OK — no reverse shims (packages/ → src/)')
    process.exit(0)
  }

  console.log(`Found ${violations.length} reverse shim(s) — packages exporting FROM src:`)
  for (const v of violations) {
    console.log(`  ${v.file}  →  ${v.canonical.replace(/\n/g, ' ')}`)
  }
  console.log('')
  console.log('V7 §3.1: shim is not owner. Move implementation into the package,')
  console.log('then leave src/ as the forward shim.')
  process.exit(1)
}

main().catch(e => { console.error(e); process.exit(2) })
