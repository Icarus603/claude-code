#!/usr/bin/env bun
/**
 * Audit 08: always-false feature flags.
 *
 * Pattern: `if (feature('X'))` where 'X' is never enabled in any
 * dev/build define configuration. The branch is permanent dead code,
 * but reads like live code. Reviewers can't tell from the if-statement
 * alone — they have to cross-check against scripts/defines.ts and
 * build.ts.
 *
 * Detection:
 *   1. Parse scripts/dev.ts for DEFAULT_FEATURES (dev-mode enabled set).
 *   2. Parse build.ts for build-mode enabled set.
 *   3. Find every `feature('X')` call site.
 *   4. Flag any X that's not in either set.
 */
import { emitJson, summarize, type Finding, type AuditResult, readSafe } from './lib.js'
import { execSync } from 'child_process'

function listEnabledFeatures(): { dev: Set<string>; build: Set<string> } {
  const dev = new Set<string>()
  const build = new Set<string>()
  // Single source of truth: scripts/default-features.ts:STABLE_FEATURES.
  // Both dev (scripts/dev.ts) and release builds (build.ts) import from
  // there, so we parse the canonical list here. Fall back to dev.ts /
  // build.ts for older revisions that still inline the array.
  const sources = [
    'scripts/default-features.ts',
    'scripts/dev.ts',
    'build.ts',
  ]
  for (const src of sources) {
    const text = readSafe(src)
    if (!text) continue
    for (const m of text.matchAll(/["']([A-Z_][A-Z0-9_]+)["']/g)) {
      dev.add(m[1])
      build.add(m[1])
    }
  }
  return { dev, build }
}

const { dev, build } = listEnabledFeatures()

let raw = ''
try {
  raw = execSync(
    `grep -rEn "feature\\(['\\\"][A-Z_][A-Z0-9_]*['\\\"]\\)" packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules`,
    { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 },
  )
} catch {}

const findings: Finding[] = []
let total = 0
for (const ln of raw.split('\n')) {
  const m = ln.match(/^([^:]+):(\d+):(.*)$/)
  if (!m) continue
  total++
  const [_, file, lineStr, content] = m
  if (file.includes('/__tests__/')) continue
  if (/^\s*(\/\/|\*|\/\*)/.test(content)) continue
  // Skip comment-line false positives
  // Extract feature names from this call site
  const flags = [...content.matchAll(/feature\(['"]([A-Z_][A-Z0-9_]+)['"]\)/g)].map(m => m[1])
  for (const flag of flags) {
    if (dev.has(flag) || build.has(flag)) continue
    findings.push({
      pattern: 'always-false-feature-flag',
      file,
      line: parseInt(lineStr, 10),
      snippet: content.trim().slice(0, 140),
      severity: 'LOW',
      note: `\`feature('${flag}')\` is not enabled in dev (scripts/dev.ts) or build (build.ts) defaults. Branch is dead code unless user manually sets FEATURE_${flag}=1. Verify whether this branch is ever exercised; if not, delete it.`,
    })
  }
}

const result: AuditResult = {
  pattern: 'always-false-feature-flag',
  description: 'feature() flags that are never enabled by default — branches are dead unless env-overridden',
  totalScanned: total,
  findings,
}

if (process.argv.includes('--summary')) {
  console.error(summarize(result))
} else {
  emitJson(result)
}
