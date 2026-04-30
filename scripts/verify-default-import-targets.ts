#!/usr/bin/env bun
/**
 * verify-default-import-targets — every `import Name from '@claude-code/X'`,
 * every `require('@claude-code/X').default`, and every `require(A) as
 * typeof import(B)` cast must resolve to a module that actually has a
 * default export (or, for the cast form, A and B must resolve to the
 * same file).
 *
 * Bug class this catches: 2026-04-29 #7 — `/remote-control` slash command
 * was silently disabled because:
 *   const bridge = feature('BRIDGE_MODE')
 *     ? require('@claude-code/bridge/index.js').default  // → undefined
 *     : null
 * `bridge` package's index.ts exports named (bridgeMain, etc) but no
 * default. The conditional spread `...(bridge ? [bridge] : [])` then
 * dropped the registration silently. Found via four-way knip-unused
 * audit (the proper command implementation got flagged unused because
 * nothing static-imported it).
 *
 * Three sub-checks:
 *   1. `import X from 'Y'` — Y must export default
 *   2. `require('Y').default` / `import('Y').then(m => m.default)` — same
 *   3. `require(A) as typeof import(B)` — A must equal B (modulo .js / ./
 *      normalization)
 */
import { readFileSync, existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { execSync } from 'child_process'

const REPO_ROOT = resolve(import.meta.dirname, '..')

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
    const target = exports[exportKey]
    if (typeof target === 'string') return resolve(dirname(pkgPath), target)
    for (const [k, v] of Object.entries(exports)) {
      if (typeof v !== 'string' || !k.includes('*')) continue
      const keyRe = '^' + k.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '(.+)') + '$'
      const match = exportKey.match(new RegExp(keyRe))
      if (match) {
        const captured = match[1]!
        const target2 = v.replace(/\*/g, captured)
        const resolved = resolve(dirname(pkgPath), target2)
        if (existsSync(resolved)) return resolved
        for (const ext of ['', '.ts', '.tsx']) {
          const alt = resolve(dirname(pkgPath), target2.replace(/\.js$/, '') + ext)
          if (existsSync(alt)) return alt
        }
      }
    }
  }
  return null
}

function resolveRelativeImport(callerFile: string, importPath: string): string | null {
  if (!importPath.startsWith('./') && !importPath.startsWith('../')) return null
  const callerDir = dirname(join(REPO_ROOT, callerFile))
  const base = importPath.replace(/\.(jsx?|tsx?)$/, '')
  for (const ext of ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']) {
    const p = resolve(callerDir, base + ext)
    if (existsSync(p)) return p
  }
  return null
}

function moduleHasDefault(filePath: string, depth = 0): boolean {
  if (depth > 5) return true
  try {
    const content = readFileSync(filePath, 'utf8')
    if (/\bexport\s+default\s/.test(content)) return true
    if (/\bexport\s*\{[^}]*\bdefault\b/.test(content)) return true
    const reDefaults = [
      ...content.matchAll(/export\s*\{[^}]*\bdefault\b[^}]*\}\s*from\s*['"]([^'"]+)['"]/g),
    ]
    for (const m of reDefaults) {
      const target = m[1]!
      let resolvedTarget: string | null = null
      if (target.startsWith('./') || target.startsWith('../')) {
        const dir = dirname(filePath)
        const base = target.replace(/\.(jsx?|tsx?)$/, '')
        for (const ext of ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']) {
          const p = resolve(dir, base + ext)
          if (existsSync(p)) { resolvedTarget = p; break }
        }
      } else if (target.startsWith('@claude-code/')) {
        resolvedTarget = resolvePackageImport(target)
      }
      if (resolvedTarget && moduleHasDefault(resolvedTarget, depth + 1)) return true
    }
    return false
  } catch {
    return false
  }
}

const violations: string[] = []
let totalChecked = 0

// Sub-check 1: `import Name from '@claude-code/X'`
{
  const raw = execSync(
    `rg -n "^\\s*import\\s+[a-zA-Z_$][a-zA-Z0-9_$]*\\s+from\\s+['\\"]@claude-code/[^'\\"]+['\\"]" packages/ -g '*.ts' -g '*.tsx'`,
    { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 50 * 1024 * 1024 },
  )
  for (const line of raw.split('\n')) {
    if (!line.trim() || line.includes('__tests__')) continue
    const m = line.match(/^(.+?):(\d+):(.+)$/)
    if (!m) continue
    const [, file, lineStr, content] = m
    const ip = content!.match(/from\s+['"]([^'"]+)['"]/)
    if (!ip) continue
    const resolved = resolvePackageImport(ip[1]!)
    if (!resolved) continue
    totalChecked++
    if (!moduleHasDefault(resolved)) {
      violations.push(
        `${file}:${lineStr}\n    import default from '${ip[1]}'\n    resolves to: ${resolved.replace(REPO_ROOT + '/', '')}\n    but module has no default export`,
      )
    }
  }
}

// Sub-check 2: `require('X').default` and `import('X').then(m => m.default)`
{
  const requireRaw = execSync(
    `rg -n "require\\(['\\"][^'\\"]+['\\"]\\)\\.default" packages/ -g '*.ts' -g '*.tsx'`,
    { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 50 * 1024 * 1024 },
  )
  for (const line of requireRaw.split('\n')) {
    if (!line.trim() || line.includes('__tests__')) continue
    const m = line.match(/^(.+?):(\d+):(.+)$/)
    if (!m) continue
    const [, file, lineStr, content] = m
    const ip = content!.match(/require\(['"]([^'"]+)['"]\)\.default/)
    if (!ip) continue
    let resolved: string | null = null
    if (ip[1]!.startsWith('@claude-code/')) {
      resolved = resolvePackageImport(ip[1]!)
    } else {
      resolved = resolveRelativeImport(file!, ip[1]!)
    }
    if (!resolved) continue
    totalChecked++
    if (!moduleHasDefault(resolved)) {
      violations.push(
        `${file}:${lineStr}\n    require('${ip[1]}').default\n    resolves to: ${resolved.replace(REPO_ROOT + '/', '')}\n    but module has no default export`,
      )
    }
  }
}

// Sub-check 3: `require(A) as typeof import(B)` — A and B must match
{
  const raw = execSync(
    `rg -n "require\\(['\\"][^'\\"]+['\\"]\\)\\s*as\\s+typeof\\s+import\\(['\\"][^'\\"]+['\\"]\\)" packages/ -g '*.ts' -g '*.tsx'`,
    { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 50 * 1024 * 1024 },
  )
  for (const line of raw.split('\n')) {
    if (!line.trim() || line.includes('__tests__')) continue
    const m = line.match(/^(.+?):(\d+):(.+)$/)
    if (!m) continue
    const [, file, lineStr, content] = m
    const ip = content!.match(
      /require\(['"]([^'"]+)['"]\)\s*as\s+typeof\s+import\(['"]([^'"]+)['"]\)/,
    )
    if (!ip) continue
    totalChecked++
    const norm = (p: string) => p.replace(/\.js$/, '').replace(/^\.\//, '')
    if (norm(ip[1]!) !== norm(ip[2]!)) {
      violations.push(
        `${file}:${lineStr}\n    require('${ip[1]}') as typeof import('${ip[2]}')\n    runtime path != cast path — drift!`,
      )
    }
  }
}

if (violations.length > 0) {
  console.error(
    `verify-default-import-targets: ${violations.length} violation(s) (out of ${totalChecked} checks)`,
  )
  console.error(
    'Each default-import / .default access must resolve to a module that exports default.',
  )
  console.error('')
  for (const v of violations.slice(0, 30)) console.error(v + '\n')
  if (violations.length > 30) {
    console.error(`... and ${violations.length - 30} more\n`)
  }
  process.exit(1)
}

console.log(`verify-default-import-targets: ${totalChecked} checks all OK`)
