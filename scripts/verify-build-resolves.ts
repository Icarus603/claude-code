#!/usr/bin/env bun
/**
 * verify-build-resolves — confirm `bun build` succeeds end-to-end.
 *
 * Lazy `bun test` resolution doesn't catch broken @claude-code/X paths
 * unless that exact module is imported by an executed test. This check
 * runs the full bundler against the CLI entry, which walks the entire
 * transitive import graph and surfaces any unresolvable specifier as a
 * compile-time error.
 *
 * Necessary because directory renames + holding-pen cleanup repeatedly
 * left dangling `@claude-code/<pkg>/<oldName>/X.js` paths that survived
 * tests but break production bundle.
 */

import { spawnSync } from 'child_process'

// Full bundle (NOT --no-bundle) — only the full bundler walks dynamic
// `await import('...')` calls. --no-bundle resolved static imports OK
// during V7 but missed dynamic ones, leading to a broken `bun run build`
// landing on main (caught only by external CI / manual full build).
const result = spawnSync('bun', [
  'build',
  'packages/cli/src/entry/cli.tsx',
  '--target=bun',
  '--outdir=/tmp/verify-build-resolves-out',
], { encoding: 'utf8' })

if (result.status !== 0) {
  console.error(result.stderr)
  console.error(result.stdout)
  process.exit(1)
}

// Surface any "Could not resolve" even on exit-0 (defensive)
const combined = (result.stderr ?? '') + (result.stdout ?? '')
if (/Could not resolve:/.test(combined)) {
  console.error(combined)
  console.error('build emitted unresolvable imports')
  process.exit(1)
}
console.log('build resolution check passed')
