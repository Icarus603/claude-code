#!/usr/bin/env bun
/**
 * verify-command-load-targets — every Command's lazy load() must
 * resolve to a module that actually exports `call`.
 *
 * Pattern in scope:
 *   const cmd = { type: 'local-jsx', load: () => import('./X.js'), ... }
 *   const cmd = { type: 'local-react', load: () => import('@pkg/foo.js'), ... }
 *
 * Bug class this catches: silent typos like `'../../tasks.js'` where
 * the path resolves to *some* file (so TypeScript is happy) but the
 * resolved module has no `call` export. Lazy import means the runtime
 * error only surfaces when a user actually invokes the slash command
 * — which means tests, smoke checks, and even `bun run dev` boot
 * don't catch it.
 *
 * Real example (2026-04-29): packages/agent/commands/tasks/index.ts
 * had `import('../../tasks.js')` — resolved to `packages/agent/tasks.ts`
 * (no `call()` — that file is the task-list state model). The intent
 * was sibling `commands/tasks/tasks.tsx`. Fix was `'./tasks.js'`.
 *
 * The verifier walks every `load: () => import('X')` in packages/, resolves
 * X using package.json#exports + relative paths, and checks the target
 * file source for an `export ... call` declaration.
 */
import { readFileSync, existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { execSync } from 'child_process'

const REPO_ROOT = resolve(import.meta.dirname, '..')

interface LoadCall {
  callerFile: string
  callerLine: number
  importPath: string
}

function findLoadCalls(): LoadCall[] {
  // ripgrep is faster than walking. Match `load: () => import('X')` and
  // `load:async () => import('X')`.
  let raw: string
  try {
    raw = execSync(
      `rg --no-heading -n -g '*.ts' -g '*.tsx' "load:\\s*(?:async\\s*)?\\(\\)\\s*=>\\s*import\\(['\\"]([^'\\"]+)['\\"]" packages/`,
      { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 10 * 1024 * 1024 },
    )
  } catch {
    return []
  }
  const calls: LoadCall[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    // Format: file:line:colcontent
    const m = line.match(/^(.+?):(\d+):(.+)$/)
    if (!m) continue
    const [, callerFile, lineStr, content] = m
    const importMatch = content!.match(/import\(['"]([^'"]+)['"]/)
    if (!importMatch) continue
    calls.push({
      callerFile: callerFile!,
      callerLine: parseInt(lineStr!, 10),
      importPath: importMatch[1]!,
    })
  }
  return calls
}

function resolvePackageImport(spec: string): string | null {
  // Resolve "@claude-code/X/Y.js" → packages/X/<exports[Y.js]>
  const m = spec.match(/^@claude-code\/([^/]+)\/(.+)$/)
  if (!m) return null
  const [, pkgName, subpath] = m
  // Search both packages/<pkgName> and packages/@ant/<pkgName>
  const candidates = [
    join(REPO_ROOT, 'packages', pkgName!, 'package.json'),
    join(REPO_ROOT, 'packages', '@ant', pkgName!, 'package.json'),
  ]
  for (const pkgPath of candidates) {
    if (!existsSync(pkgPath)) continue
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const exports = pkg.exports ?? {}
    const exportKey = './' + subpath
    const target = exports[exportKey]
    if (typeof target === 'string') {
      return resolve(dirname(pkgPath), target)
    }
  }
  return null
}

function resolveImport(call: LoadCall): string | null {
  const { callerFile, importPath } = call
  if (importPath.startsWith('@claude-code/')) {
    return resolvePackageImport(importPath)
  }
  if (importPath.startsWith('./') || importPath.startsWith('../')) {
    // Strip .js extension and try .ts/.tsx
    const callerDir = dirname(join(REPO_ROOT, callerFile))
    const base = importPath.replace(/\.js$/, '')
    for (const ext of ['.ts', '.tsx']) {
      const p = resolve(callerDir, base + ext)
      if (existsSync(p)) return p
    }
    return null
  }
  return null // skip non-package non-relative paths
}

function moduleHasCall(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, 'utf8')
    // Match `export ... call` — function/const/let/async-function
    return /\bexport\s+(?:async\s+)?(?:function|const|let|var)\s+call\b/.test(
      content,
    )
  } catch {
    return false
  }
}

const calls = findLoadCalls()
const violations: string[] = []

for (const call of calls) {
  const resolved = resolveImport(call)
  if (resolved === null) {
    // Couldn't resolve; this could be an external package or unsupported.
    // Don't fail — verifier focuses on intra-repo command loaders.
    continue
  }
  if (!moduleHasCall(resolved)) {
    const relResolved = resolved.replace(REPO_ROOT + '/', '')
    violations.push(
      `${call.callerFile}:${call.callerLine}  load: () => import('${call.importPath}')\n` +
        `    → resolves to: ${relResolved}\n` +
        `    but that module has no \`export call\``,
    )
  }
}

if (violations.length > 0) {
  console.error(
    `verify-command-load-targets: ${violations.length} violation(s)`,
  )
  console.error(
    'Each Command\'s load() must yield a module that exports `call`.',
  )
  console.error('')
  for (const v of violations) console.error(v + '\n')
  process.exit(1)
}

console.log(
  `verify-command-load-targets: ${calls.length} load() targets OK`,
)
