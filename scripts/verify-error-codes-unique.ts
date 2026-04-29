#!/usr/bin/env bun
/**
 * verify-error-codes-unique — error code strings must be globally unique.
 *
 * Each package defines a *BaseError class with a `code: string` field. The
 * code surfaces to host telemetry, log scraping, and alert rules — if two
 * subclasses (within or across packages) accidentally share a code,
 * downstream metric routing silently mis-attributes events.
 *
 * No individual package's tests can catch this — each package's
 * uniqueness check (via existing __tests__/errors.test.ts files) only
 * sees its own subset.
 *
 * This verifier scans all packages/**\/errors.ts, extracts every
 * `super('CODE_STRING', ...)` call inside an Error subclass constructor,
 * and asserts each CODE_STRING is unique globally.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const PACKAGES_DIR = join(REPO_ROOT, 'packages')

type ErrorEntry = {
  file: string
  className: string
  code: string
  line: number
}

function findErrorFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      // Skip node_modules, __tests__, dist, .git
      if (
        entry === 'node_modules' ||
        entry === '__tests__' ||
        entry === 'dist' ||
        entry.startsWith('.')
      ) {
        continue
      }
      results.push(...findErrorFiles(full))
    } else if (entry === 'errors.ts') {
      results.push(full)
    }
  }
  return results
}

/**
 * Extract error code strings from a file. Looks for the pattern:
 *
 *   class FooError extends BarError {
 *     constructor(...) {
 *       super('SOME_CODE', ...)
 *     }
 *   }
 *
 * Captures (className, code) pairs.
 */
function extractEntries(filePath: string): ErrorEntry[] {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const entries: ErrorEntry[] = []

  let currentClass: string | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    const classMatch = line.match(/^export class (\w+Error)\s+extends/)
    if (classMatch) {
      currentClass = classMatch[1]!
      continue
    }

    if (currentClass) {
      // Look for super('CODE', ...) — the code must be a string literal,
      // not a variable / template / computed expression.
      const superMatch = line.match(/super\(\s*['"]([A-Z][A-Z0-9_]+)['"]/)
      if (superMatch) {
        entries.push({
          file: filePath,
          className: currentClass,
          code: superMatch[1]!,
          line: i + 1,
        })
        // Reset after a single super call — most subclasses have one.
        // If the same class has multiple super calls (rare), they'd all
        // get the same className tag, which is correct.
      }

      // Reset currentClass on a closing brace at column 0.
      if (line.match(/^}\s*$/)) {
        currentClass = null
      }
    }
  }
  return entries
}

async function main(): Promise<void> {
  const errorFiles = findErrorFiles(PACKAGES_DIR)
  const allEntries: ErrorEntry[] = []
  for (const file of errorFiles) {
    allEntries.push(...extractEntries(file))
  }

  // Build code → entries map.
  const byCode = new Map<string, ErrorEntry[]>()
  for (const entry of allEntries) {
    if (!byCode.has(entry.code)) byCode.set(entry.code, [])
    byCode.get(entry.code)!.push(entry)
  }

  const duplicates: Array<{ code: string; entries: ErrorEntry[] }> = []
  for (const [code, entries] of byCode) {
    if (entries.length > 1) {
      duplicates.push({ code, entries })
    }
  }

  if (duplicates.length > 0) {
    console.error('verify-error-codes-unique: collision(s) detected')
    for (const { code, entries } of duplicates) {
      console.error(`  - "${code}" used by ${entries.length} class(es):`)
      for (const e of entries) {
        const rel = e.file.replace(REPO_ROOT + '/', '')
        console.error(`    · ${e.className} (${rel}:${e.line})`)
      }
    }
    console.error('')
    console.error(
      'Each error code must be globally unique. Codes surface to host telemetry / log alerts;\n' +
        'a duplicate silently mis-routes events between subsystems.\n' +
        'Either rename one of the colliding codes (preferred) or merge the classes.',
    )
    throw new Error(`${duplicates.length} duplicate error code(s)`)
  }

  console.log(
    `verify-error-codes-unique: ${allEntries.length} codes across ${errorFiles.length} files, all unique`,
  )
}

await main()
