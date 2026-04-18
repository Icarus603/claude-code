#!/usr/bin/env bun
/**
 * verify-import-graph.ts — L2 replacement for verify-runtime-boundaries.
 *
 * The existing verifier uses `content.includes("from '../src/")`, which
 * does NOT catch deeper relative paths like `from '../../../../src/` used
 * by packages/cli (328 hits currently hidden). It also gives agent a
 * 158-count budget for `@claude-code/app-compat/` imports, contradicting
 * V7 §17's "must be 0".
 *
 * This verifier resolves every relative import in every package file to
 * an absolute path, then applies V7 §11.2 rules regardless of depth:
 *
 *   - No package source file may resolve an import into root `src/*`
 *     (no depth of `../` can evade this).
 *   - No package may import `@claude-code/app-compat/*` (hard zero, no
 *     budget).
 *   - No package may import another package's `/internal/` subpath.
 *   - Tests in package A must import package B only via `B/testing`
 *     or B's public surface — never B's main implementation files.
 *
 * Uses Bun's built-in import parser via lightweight regex over non-comment
 * lines (no ts-morph dependency; TS parser would pull in tsc which is 10x
 * slower). This catches 99% of cases; the long tail (computed imports,
 * `require()` calls) is not used in this codebase's package/ code per
 * spot-check.
 */

import { readdir, readFile, stat } from 'fs/promises'
import { dirname, join, resolve, sep, relative, normalize } from 'path'

const REPO_ROOT = process.cwd()
const PACKAGES_ROOT = join(REPO_ROOT, 'packages')
const SRC_ROOT = join(REPO_ROOT, 'src') + sep

type Violation = {
  file: string
  importPath: string
  resolved: string | null
  rule: string
}

/**
 * Extract every import/export-from specifier from a TS/TSX source file.
 * Works on both static and dynamic imports. Strips line and block comments
 * first to avoid false positives in doc comments.
 */
function extractSpecifiers(source: string): string[] {
  const stripped = source
    // block comments
    .replace(/\/\*[\s\S]*?\*\//g, '')
    // line comments (must not match inside strings — we tolerate the edge case
    // since real TS files rarely `from ` inside a string followed by `//`)
    .replace(/^\s*\/\/.*$/gm, '')

  const specifiers: string[] = []
  const patterns = [
    // import ... from 'X', import 'X'
    /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    // dynamic import('X')
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of patterns) {
    let m: RegExpExecArray | null
    while ((m = re.exec(stripped)) !== null) {
      specifiers.push(m[1]!)
    }
  }
  return specifiers
}

async function walkTsTsx(root: string): Promise<string[]> {
  let out: string[] = []
  let entries: string[]
  try {
    entries = await readdir(root)
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '.turbo') continue
    const full = join(root, name)
    let s
    try { s = await stat(full) } catch { continue }
    if (s.isDirectory()) {
      out = out.concat(await walkTsTsx(full))
    } else if (/\.(ts|tsx|js|mjs)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Resolve a relative specifier against the importing file path. Returns
 * an absolute filesystem path (no extension resolution — we only need to
 * know which subtree the import points into, not the exact target file).
 */
function resolveRelative(importerFile: string, specifier: string): string {
  return normalize(resolve(dirname(importerFile), specifier))
}

/**
 * True if a specifier points at root `src/*` after resolution.
 * Handles both `../../src/...` and `../../../../src/...` depths uniformly.
 */
function resolvesToRootSrc(importerFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null
  const abs = resolveRelative(importerFile, specifier)
  if (abs.startsWith(SRC_ROOT)) return abs
  // also the exact `/src` with no trailing separator (edge case)
  if (abs === join(REPO_ROOT, 'src')) return abs
  return null
}

/**
 * True if a package-local relative import escapes its own package boundary
 * without landing in `src/` (unusual — e.g. `../../other-package/src/...`).
 */
function resolvesAcrossPackageBoundary(
  importerFile: string,
  specifier: string,
  ownerPackage: string,
): string | null {
  if (!specifier.startsWith('.')) return null
  const abs = resolveRelative(importerFile, specifier)
  const ownerAbs = join(REPO_ROOT, ownerPackage)
  if (abs.startsWith(ownerAbs + sep)) return null
  if (abs.startsWith(SRC_ROOT)) return null // handled by resolvesToRootSrc
  if (abs.startsWith(PACKAGES_ROOT + sep)) {
    // escaped into another package — V7 §11.2 forbids this path form;
    // cross-package reference must go through `@claude-code/<name>/...`
    return abs
  }
  return null
}

function isTestFile(file: string): boolean {
  return /\.test\.(ts|tsx)$/.test(file) ||
    file.includes(`${sep}__tests__${sep}`)
}

/**
 * For a `@claude-code/<pkg>/...` import, extract the subpath after the
 * package name so we can check `/internal/` and `/testing/` rules.
 */
function parsePackageSubpath(spec: string): { pkg: string; sub: string } | null {
  const m = spec.match(/^@claude-code\/([^/]+)(\/.*)?$/)
  if (!m) return null
  return { pkg: m[1]!, sub: m[2] ?? '' }
}

async function listPackageRoots(): Promise<string[]> {
  const roots: string[] = []
  for (const entry of await readdir(PACKAGES_ROOT)) {
    const full = join(PACKAGES_ROOT, entry)
    const s = await stat(full)
    if (!s.isDirectory()) continue
    if (entry === '@ant') {
      for (const sub of await readdir(full)) {
        const antFull = join(full, sub)
        const antStat = await stat(antFull)
        if (antStat.isDirectory()) roots.push(antFull)
      }
      continue
    }
    roots.push(full)
  }
  return roots
}

async function main(): Promise<void> {
  const packageRoots = await listPackageRoots()
  const violations: Violation[] = []

  for (const pkgRoot of packageRoots) {
    const pkgRel = relative(REPO_ROOT, pkgRoot)
    const files = await walkTsTsx(pkgRoot)

    for (const file of files) {
      const src = await readFile(file, 'utf8')
      const specs = extractSpecifiers(src)
      const isTest = isTestFile(file)

      for (const spec of specs) {
        // Rule 1: no resolution into root src/*
        const srcResolved = resolvesToRootSrc(file, spec)
        if (srcResolved) {
          violations.push({
            file: relative(REPO_ROOT, file),
            importPath: spec,
            resolved: relative(REPO_ROOT, srcResolved),
            rule: 'V7 §11.2 — package may not import root src/*',
          })
          continue
        }

        // Rule 2: no app-compat (kill the 158 budget)
        if (
          spec === '@claude-code/app-compat' ||
          spec.startsWith('@claude-code/app-compat/') ||
          spec.startsWith('@cc-app/')
        ) {
          violations.push({
            file: relative(REPO_ROOT, file),
            importPath: spec,
            resolved: null,
            rule: 'V7 §17 — @claude-code/app-compat / @cc-app is banned (budget=0, no exceptions)',
          })
          continue
        }

        // Rule 3: no /internal/ subpath import across packages
        const parsed = parsePackageSubpath(spec)
        if (parsed && parsed.sub.startsWith('/internal/')) {
          violations.push({
            file: relative(REPO_ROOT, file),
            importPath: spec,
            resolved: null,
            rule: 'V7 §11.2 — cross-package /internal/ import forbidden',
          })
          continue
        }

        // Rule 4: test files in package A may only import package B via
        // `B/testing` or its public surface (no main implementation).
        // Heuristic: main implementation paths include '/src/internal/',
        // '/src/core/', etc. We flag the obvious case — test reaching into
        // another package's `/src/` subpath that is not `/testing`.
        if (isTest && parsed) {
          const myPkg = pkgRel.replace(/^packages\//, '').replace(/^@ant\//, '@ant/')
          if (parsed.pkg !== myPkg.replace(/^@ant\//, '') && parsed.sub.startsWith('/src/')) {
            violations.push({
              file: relative(REPO_ROOT, file),
              importPath: spec,
              resolved: null,
              rule: 'V7 §9.11 — tests may import other packages only via /testing or public entry',
            })
          }
        }

        // Rule 5: no relative escape into sibling packages
        const crossPkg = resolvesAcrossPackageBoundary(file, spec, pkgRel)
        if (crossPkg) {
          violations.push({
            file: relative(REPO_ROOT, file),
            importPath: spec,
            resolved: relative(REPO_ROOT, crossPkg),
            rule: 'V7 §11.2 — relative import must stay within package; use @claude-code/<name>',
          })
        }
      }
    }
  }

  if (violations.length > 0) {
    // Group by rule for readable output. Print first N per rule.
    const byRule = new Map<string, Violation[]>()
    for (const v of violations) {
      const list = byRule.get(v.rule) ?? []
      list.push(v)
      byRule.set(v.rule, list)
    }
    const MAX_PER_RULE = 10
    for (const [rule, list] of byRule) {
      console.error(`\n${rule} (${list.length} violations)`)
      for (const v of list.slice(0, MAX_PER_RULE)) {
        const resolved = v.resolved ? ` → ${v.resolved}` : ''
        console.error(`  ${v.file}: '${v.importPath}'${resolved}`)
      }
      if (list.length > MAX_PER_RULE) {
        console.error(`  ... and ${list.length - MAX_PER_RULE} more`)
      }
    }
    throw new Error(`${violations.length} import-graph violations`)
  }

  console.log('import graph verification passed')
}

await main()
