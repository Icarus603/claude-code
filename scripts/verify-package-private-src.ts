#!/usr/bin/env bun
/**
 * verify-package-private-src — packages/<A> must not import from
 * '@claude-code/<B>/src/...'. The `src/` segment is each package's
 * private internal layout; cross-package consumers must go through
 * the package's public exports map.
 *
 * Why this matters: if package B reorganizes its src/ tree (e.g.,
 * src/foo.ts → src/internal/foo.ts), nothing breaks for B's own files
 * but every external consumer that bypassed exports breaks silently.
 * Treating src/ as private forces deliberate API surface.
 */

import { readFile } from 'fs/promises'
import { Glob } from 'bun'

const VIOLATION_RE =
  /(?:from|import|require)\s*\(?\s*['"](@claude-code\/[^'"\s)]+\/src\/[^'"\s)]+)['"]/g

const violations: { file: string; spec: string }[] = []

for await (const file of new Glob('packages/**/*.{ts,tsx}').scan('.')) {
  if (file.includes('node_modules/')) continue
  const content = await readFile(file, 'utf8')
  let m: RegExpExecArray | null
  VIOLATION_RE.lastIndex = 0
  while ((m = VIOLATION_RE.exec(content))) {
    violations.push({ file, spec: m[1] })
  }
}

if (violations.length > 0) {
  console.error(`✗ package-private-src: ${violations.length} cross-package imports reaching into src/:`)
  for (const v of violations.slice(0, 30)) {
    console.error(`  ${v.file} → ${v.spec}`)
  }
  if (violations.length > 30) {
    console.error(`  ... and ${violations.length - 30} more`)
  }
  console.error(
    "\nUse the package's public exports (./X.js entries) instead of reaching into ./src/.",
  )
  process.exit(1)
}
console.log('package-private-src check passed')
