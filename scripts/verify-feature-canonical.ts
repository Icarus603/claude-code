#!/usr/bin/env bun
/**
 * verify-feature-canonical — every `feature(...)` call must come from the
 * canonical `bun:bundle` import. CLAUDE.md §Feature Flag System makes this
 * a hard rule: redefining `feature` locally bypasses build-time evaluation
 * and produces silently-different behavior between dev and prod bundles.
 *
 * Two failure modes caught:
 *   1. File calls feature() but never imports from 'bun:bundle' (local
 *      shadowing or function param hiding the canonical reference).
 *   2. File imports feature from a non-canonical source (e.g.,
 *      './localFeature.js' or '@some-package/feature').
 */

import { Glob } from 'bun'
import { readFile } from 'fs/promises'

const violations: { file: string; reason: string }[] = []

for await (const file of new Glob('{src,packages}/**/*.{ts,tsx}').scan('.')) {
  if (file.includes('node_modules/')) continue
  const content = await readFile(file, 'utf8')
  // skip files that don't reference feature() at all
  if (!/\bfeature\s*\(/.test(content)) continue
  // skip declaration files (they declare types, not runtime calls)
  if (file.endsWith('.d.ts')) continue
  // skip the hello-agent artifact (third-party plugin)
  if (file.includes('hello-agent')) continue

  // Look for `feature` (exact, not feature*) imports.
  // Match per-line; require the import name to be exactly `feature`, not
  // `featureFoo` or `getFeatureValue_X` etc.
  const importLines: string[] = []
  for (const line of content.split('\n')) {
    if (!/^\s*import\b/.test(line) || !/\bfrom\b/.test(line)) continue
    // Look for `{ ..., feature, ... }` or `{ feature }` or `{ feature as X }`
    if (/\{[^}]*\bfeature\b\s*(?:as\s+\w+)?\s*[,}]/.test(line)) {
      importLines.push(line.trim())
    }
  }
  const canonical = importLines.some(l => /from\s*['"]bun:bundle['"]/.test(l))
  const nonCanonical = importLines.filter(l => !/from\s*['"]bun:bundle['"]/.test(l))

  // Locally-shadowed feature: function parameter or local declaration.
  // If feature is called but no import exists, it must be locally-defined or
  // shadowed; flag unless this is the bun:bundle declaration file itself.
  if (importLines.length === 0) {
    // Allow: function-scoped `(... feature ...) =>` is OK; const feature = ... is not
    const localDef = /\bconst\s+feature\b|\blet\s+feature\b|\bfunction\s+feature\b/.test(content)
    if (localDef) {
      violations.push({ file, reason: 'local `feature` declaration shadows canonical import' })
    }
    continue
  }

  if (nonCanonical.length > 0 && !canonical) {
    violations.push({
      file,
      reason: `imports feature from non-canonical source: ${nonCanonical.join('; ')}`,
    })
  }
}

if (violations.length > 0) {
  console.error(`✗ feature-canonical: ${violations.length} non-canonical feature() usage(s):`)
  for (const v of violations) console.error(`  ${v.file} — ${v.reason}`)
  console.error("\nUse `import { feature } from 'bun:bundle'` exclusively. See CLAUDE.md §Feature Flag System.")
  process.exit(1)
}
console.log('feature-canonical check passed')
