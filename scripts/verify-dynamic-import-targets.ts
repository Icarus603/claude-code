#!/usr/bin/env bun
/**
 * verify-dynamic-import-targets — every dynamic `import('X')` and
 * `require('X') as typeof import('X')` in packages/ must resolve to a
 * real file, AND any `{name}` destructured from the result must actually
 * be exported by the resolved module.
 *
 * Bug class this catches: silent typos like
 *   import('../../utils/systemThemeWatcher.js')   // wrong dir
 *   require('../services/skillSearch/prefetch.js') // wrong dir
 *   const { execIntoTmuxWorktree } = await import('@claude-code/swarm') // not exported
 * These pass TypeScript (the cast is on the type side; the runtime path
 * is unverified) but throw at runtime — and only if the code path is
 * actually reached. With feature-flag gates, that may be never in tests.
 *
 * Discovery (2026-04-29 audit, 758 imports across packages/): 2 real
 * bugs surfaced — ThemeProvider's auto-theme watcher and attachments'
 * EXPERIMENTAL_SKILL_SEARCH prefetch import. Both gated behind opt-in
 * flags so they never crashed CI.
 *
 * Resolves: package.json#exports (incl. wildcard pattern keys),
 * relative paths with bun-style ext-mapping (.js → .ts/.tsx, .jsx →
 * .tsx), and `export * from './X'` re-export chains up to depth 5.
 */
import { readFileSync, existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { execSync } from 'child_process'

const REPO_ROOT = resolve(import.meta.dirname, '..')

interface ImportCall {
  callerFile: string
  callerLine: number
  importPath: string
  destructured: string[] // names extracted via `const { x, y } = await import(...)`
  raw: string
}

function findDynamicImports(): ImportCall[] {
  const raw = execSync(
    `rg -n "import\\(['\\"][@./]" packages/ -g '*.ts' -g '*.tsx'`,
    { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 100 * 1024 * 1024 },
  )
  const calls: ImportCall[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    if (line.includes('__tests__') || line.includes('.test.')) continue
    const m = line.match(/^(.+?):(\d+):(.+)$/)
    if (!m) continue
    const [, callerFile, lineStr, content] = m
    // Match BOTH `import('X')` and `require('X')` patterns
    const matches = [...content!.matchAll(/(?:import|require)\(['"]([^'"]+)['"]/g)]
    for (const im of matches) {
      const importPath = im[1]!
      // Skip non-relative + non-@claude-code (third-party packages, dynamic specs)
      if (!importPath.startsWith('@claude-code/') && !importPath.startsWith('./') && !importPath.startsWith('../')) continue
      // Try to detect destructured names from same line — best-effort
      const destruct: string[] = []
      const destructMatch = content!.match(/(?:const|let|var)\s*\{\s*([^}]+)\s*\}/)
      if (destructMatch) {
        for (const name of destructMatch[1]!.split(',')) {
          const cleanName = name.trim().split(':')[0]!.trim().replace(/^\.\.\./, '')
          if (cleanName && /^[a-zA-Z_$][\w$]*$/.test(cleanName)) {
            destruct.push(cleanName)
          }
        }
      }
      calls.push({
        callerFile: callerFile!,
        callerLine: parseInt(lineStr!, 10),
        importPath,
        destructured: destruct,
        raw: content!.trim(),
      })
    }
  }
  return calls
}

function resolvePackageImport(spec: string): string | null {
  const m = spec.match(/^@claude-code\/([^/]+)(?:\/(.+))?$/)
  if (!m) return null
  const [, pkgName, subpath] = m
  const candidates = [
    join(REPO_ROOT, 'packages', pkgName!, 'package.json'),
    join(REPO_ROOT, 'packages', '@ant', pkgName!, 'package.json'),
  ]
  for (const pkgPath of candidates) {
    if (!existsSync(pkgPath)) continue
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const exports = pkg.exports ?? {}
    const exportKey = subpath ? './' + subpath : '.'
    // 1. Direct match
    const target = exports[exportKey]
    if (typeof target === 'string') {
      return resolve(dirname(pkgPath), target)
    }
    // 2. Wildcard match — exports have keys like "./tools/*.js": "./src/tools/*.ts"
    for (const [k, v] of Object.entries(exports)) {
      if (typeof v !== 'string') continue
      if (!k.includes('*')) continue
      const keyRe = '^' + k.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '(.+)') + '$'
      const match = exportKey.match(new RegExp(keyRe))
      if (match) {
        const captured = match[1]!
        const target2 = v.replace(/\*/g, captured)
        const resolved = resolve(dirname(pkgPath), target2)
        if (existsSync(resolved)) return resolved
        // Try .ts/.tsx alternates
        for (const ext of ['', '.ts', '.tsx']) {
          const alt = resolve(dirname(pkgPath), target2.replace(/\.js$/, '') + ext)
          if (existsSync(alt)) return alt
        }
      }
    }
  }
  return null
}

function resolveImport(call: ImportCall): string | null {
  if (call.importPath.startsWith('@claude-code/')) {
    return resolvePackageImport(call.importPath)
  }
  if (call.importPath.startsWith('./') || call.importPath.startsWith('../')) {
    const callerDir = dirname(join(REPO_ROOT, call.callerFile))
    // Bun-style resolver: .js → .ts/.tsx, .jsx → .tsx, naked → .ts/.tsx
    const base = call.importPath.replace(/\.(jsx?|tsx?)$/, '')
    for (const ext of ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']) {
      const p = resolve(callerDir, base + ext)
      if (existsSync(p)) return p
    }
    return null
  }
  return null
}

function moduleHasName(filePath: string, name: string, depth = 0): boolean {
  if (depth > 5) return true // bail out — assume yes to avoid infinite recursion
  try {
    const content = readFileSync(filePath, 'utf8')
    if (name === 'default') {
      return /\bexport\s+default\s/.test(content)
    }
    const patterns = [
      new RegExp(`\\bexport\\s+(?:async\\s+)?(?:function|const|let|var|class)\\s+${name}\\b`),
      new RegExp(`\\bexport\\s+\\{[^}]*\\b${name}\\b`),
      new RegExp(`\\bexport\\s+type\\s+${name}\\b`),
      new RegExp(`\\bexport\\s+interface\\s+${name}\\b`),
      new RegExp(`\\bexport\\s+enum\\s+${name}\\b`),
    ]
    for (const p of patterns) {
      if (p.test(content)) return true
    }
    // Handle `export * from './X'` chains — recurse into each
    const reExports = [...content.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)]
    for (const m of reExports) {
      const target = m[1]!
      let resolvedTarget: string | null = null
      if (target.startsWith('./') || target.startsWith('../')) {
        const dir = dirname(filePath)
        const base = target.replace(/\.js$/, '')
        for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
          const p = resolve(dir, base + ext)
          if (existsSync(p)) {
            resolvedTarget = p
            break
          }
        }
      } else if (target.startsWith('@claude-code/')) {
        resolvedTarget = resolvePackageImport(target)
      }
      if (resolvedTarget && moduleHasName(resolvedTarget, name, depth + 1)) {
        return true
      }
    }
    return false
  } catch {
    return false
  }
}

const calls = findDynamicImports()
console.log(`Total dynamic imports to audit: ${calls.length}`)

const violations: string[] = []
let unresolvedCount = 0
let resolvedOK = 0
let destructuredChecks = 0

for (const call of calls) {
  const resolved = resolveImport(call)
  if (!resolved) {
    unresolvedCount++
    violations.push(
      `${call.callerFile}:${call.callerLine}\n    import('${call.importPath}') — UNRESOLVABLE\n    raw: ${call.raw.slice(0, 100)}`,
    )
    continue
  }
  resolvedOK++
  // Check destructured names if any
  for (const name of call.destructured) {
    destructuredChecks++
    if (!moduleHasName(resolved, name)) {
      violations.push(
        `${call.callerFile}:${call.callerLine}\n    import('${call.importPath}')\n    → ${resolved.replace(REPO_ROOT + '/', '')}\n    destructures \`${name}\` but no such export found`,
      )
    }
  }
}

if (violations.length > 0) {
  console.error(
    `verify-dynamic-import-targets: ${violations.length} violation(s) ` +
      `(out of ${calls.length} dynamic imports across packages/)`,
  )
  console.error(
    'Each dynamic import target must resolve, and each destructured name must be exported.',
  )
  console.error('')
  for (const v of violations.slice(0, 30)) console.error(v + '\n')
  if (violations.length > 30) {
    console.error(`... and ${violations.length - 30} more\n`)
  }
  process.exit(1)
}

console.log(
  `verify-dynamic-import-targets: ${calls.length} dynamic imports OK (${destructuredChecks} destructured-name checks)`,
)
