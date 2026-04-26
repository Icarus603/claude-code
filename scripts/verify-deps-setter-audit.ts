#!/usr/bin/env bun
/**
 * verify-deps-setter-audit — every setter shim in packages/<X>/_deps.ts
 * with a dangerous default (returns null / undefined / [] / {} / empty
 * object) MUST also be wired at boot via setXxxFn(real). Otherwise the
 * default leaks to consumers that expect a non-empty shape, producing
 * the "is not a function / Spread of undefined / property of undefined"
 * class of bugs that broke plugin loading 4× this session.
 *
 * The check is heuristic: parses the setter declarations, extracts each
 * `setXxxFn` name, and checks that the symbol is referenced from at
 * least one app-host install*.ts file. Setters that are wired AND
 * setters with sensible non-empty defaults pass.
 */

import { Glob } from 'bun'
import { readFile } from 'fs/promises'

const DANGEROUS_DEFAULT_RE =
  /=>\s*(?:null|undefined|\(\)|\[\s*\]|\{\s*\}|''|""|0)\s*[,)]/

type SetterSite = {
  file: string
  setterName: string
  defaultExpr: string
  line: number
  isDangerous: boolean
}

const setters: SetterSite[] = []

for await (const f of new Glob('packages/**/_deps.ts').scan('.')) {
  if (f.includes('node_modules/')) continue
  const lines = (await readFile(f, 'utf8')).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    // Match: const [_getX, setXFn_] = makeSetter(...)
    const m1 = line.match(/const\s+\[_get(\w+),\s*set(\w+)Fn_\]\s*=\s*makeSetter\(([^)]*)\)/)
    if (m1) {
      setters.push({
        file: f,
        setterName: `set${m1[2]}Fn`,
        defaultExpr: m1[3]!,
        line: i + 1,
        isDangerous: DANGEROUS_DEFAULT_RE.test(m1[3]!),
      })
      continue
    }
    // Match: let _xxxFn: ... = ...
    const m2 = line.match(/^let\s+_(\w+)(?::\s*[^=]+)?\s*=\s*(.*)$/)
    if (m2 && lines[i + 1]?.match(new RegExp(`set${m2[1]!.charAt(0).toUpperCase()}${m2[1]!.slice(1)}Fn`))) {
      setters.push({
        file: f,
        setterName: `set${m2[1]!.charAt(0).toUpperCase()}${m2[1]!.slice(1)}Fn`,
        defaultExpr: m2[2]!,
        line: i + 1,
        isDangerous: DANGEROUS_DEFAULT_RE.test(m2[2]!),
      })
    }
  }
}

// Find which setters are wired at boot (referenced from install*.ts)
const wired = new Set<string>()
for await (const f of new Glob('packages/app-host/src/runtime/install*.ts').scan('.')) {
  const content = await readFile(f, 'utf8')
  for (const s of setters) {
    if (content.includes(s.setterName)) wired.add(s.setterName)
  }
}

const dangerousUnwired = setters.filter(s => s.isDangerous && !wired.has(s.setterName))

const BUDGET = 70 // post-#111 baseline (today's snapshot)

if (dangerousUnwired.length > BUDGET) {
  console.error(
    `✗ deps-setter-audit: ${dangerousUnwired.length} dangerous unwired setters (budget ${BUDGET})`,
  )
  console.error('  Each is a potential "default leaks to consumer" bug:')
  for (const s of dangerousUnwired.slice(0, 20)) {
    console.error(`  ${s.file}:${s.line} ${s.setterName} default=${s.defaultExpr.trim()}`)
  }
  if (dangerousUnwired.length > 20) {
    console.error(`  ... and ${dangerousUnwired.length - 20} more`)
  }
  console.error(
    '\nFix: either wire the setter at boot in app-host/installXxxBindings.ts,\n' +
      'or convert default to a lazy-require pattern (see _deps.ts McpServerConfigSchema).',
  )
  process.exit(1)
}

console.log(
  `deps-setter-audit: ${setters.length} setters total, ${dangerousUnwired.length} dangerous + unwired (budget ${BUDGET}, ${wired.size} wired)`,
)
