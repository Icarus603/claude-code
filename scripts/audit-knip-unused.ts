#!/usr/bin/env bun
/**
 * audit-knip-unused — classify knip's "unused file" findings into:
 *   (a) safe-to-delete: 0 callers via any path AND not in package.json#exports
 *   (b) preserve: in package.json#exports (deleting breaks public API)
 *   (c) false-positive: knip missed an intra-package relative import
 *   (d) feature-gated: filename matches a `feature('X')` pattern import
 *
 * Outputs Markdown to docs/refactor/knip-unused-classification.md.
 * Read-only — does NOT delete anything.
 */
import { readFileSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import { join, dirname } from 'path'

interface KnipReport {
  issues: Array<{
    file?: string
    files?: Array<{ name: string }>
  }>
}

function getKnipFiles(): string[] {
  // knip exits non-zero when issues exist (which is the whole point of this
  // script). Wrap in a try/catch to keep the JSON output regardless of exit.
  let out = ''
  try {
    out = execSync('bunx knip --reporter json 2>/dev/null', {
      encoding: 'utf8',
      maxBuffer: 100 * 1024 * 1024,
    })
  } catch (e) {
    // execSync attaches stdout to the error when exit != 0
    const err = e as { stdout?: Buffer | string }
    out = typeof err.stdout === 'string' ? err.stdout : err.stdout?.toString() ?? ''
  }
  const report: KnipReport = JSON.parse(out)
  const files = new Set<string>()
  for (const issue of report.issues) {
    for (const f of issue.files ?? []) {
      files.add(f.name)
    }
  }
  return [...files].filter(f => f.startsWith('packages/'))
}

function findPackageJson(filePath: string): string | null {
  let dir = dirname(filePath)
  while (dir.length > 1 && !dir.endsWith('packages')) {
    try {
      readFileSync(join(dir, 'package.json'), 'utf8')
      return join(dir, 'package.json')
    } catch {
      // walk up
    }
    dir = dirname(dir)
  }
  return null
}

function basenameNoExt(file: string): string {
  const base = file.split('/').pop() ?? file
  return base.replace(/\.tsx?$/, '')
}

function isInPackageExports(file: string): boolean {
  const pj = findPackageJson(file)
  if (!pj) return false
  try {
    const pkg = JSON.parse(readFileSync(pj, 'utf8'))
    if (!pkg.exports) return false
    const pkgRoot = dirname(pj)
    const relPath = file.startsWith(pkgRoot + '/')
      ? file.slice(pkgRoot.length + 1)
      : file
    for (const v of Object.values(pkg.exports) as Array<string | unknown>) {
      if (typeof v !== 'string') continue
      // Exports values are usually like './foo.ts' — strip leading './' and
      // compare to relPath (also without './').
      const cleaned = v.startsWith('./') ? v.slice(2) : v
      if (cleaned === relPath) return true
    }
    return false
  } catch {
    return false
  }
}

function hasRelativeCallers(file: string): number {
  const pj = findPackageJson(file)
  if (!pj) return 0
  const pkgRoot = dirname(pj)
  const base = basenameNoExt(file)
  // Search for `from '../..' or './' paths that end with the basename
  // (static imports). Plus `import('./X.js')` (dynamic imports) — knip
  // doesn't trace those, but command-loader patterns rely on them
  // heavily (load: () => import('./X.js')). Combine both into one count.
  try {
    const staticOut = execSync(
      `grep -rE "from\\s+['\\\"]\\.{1,2}/(.*/)?\\b${base}(\\.js)?['\\\"]" ${pkgRoot} --include='*.ts' --include='*.tsx' 2>/dev/null || true`,
      { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
    )
    const dynamicOut = execSync(
      `grep -rE "import\\(\\s*['\\\"]\\.{1,2}/(.*/)?\\b${base}(\\.js)?['\\\"]\\s*\\)" ${pkgRoot} --include='*.ts' --include='*.tsx' 2>/dev/null || true`,
      { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
    )
    const total = (staticOut.trim() ? staticOut.trim().split('\n').length : 0) +
      (dynamicOut.trim() ? dynamicOut.trim().split('\n').length : 0)
    return total
  } catch {
    return 0
  }
}

function hasFeatureGate(file: string): boolean {
  // Heuristic: filename or path components match a known feature subsystem.
  // Loose camelCase + path-segment match. Operator should confirm before
  // delete on anything matching this list (per memory feedback_never_delete_feature_flags).
  return /\/(kairos|proactive|teammem|ablation|fork[Ss]ubagent|review[Aa]rtifact|workflow[Ss]cripts|monitor[Tt]ool|terminal[Pp]anel|uds[Ii]nbox|web[Bb]rowser|skill[Ss]earch|kairos[Bb]rief|skill[Ii]mprovement|extract[Mm]emories|growthbook|claudeInChrome|fileIndex|directConnect|sshRemote)\//i.test(
    file,
  )
}

// Real binary entrypoints — knip flags these because they're in its
// `entry:` config (knip considers them "unused" since nothing else imports
// them). They're the literal program entry, NOT deletable.
const BINARY_ENTRYPOINTS = new Set([
  'packages/cli/src/entry/cli.tsx',
  'packages/cli/src/entry/main.tsx',
  'packages/cli/src/entry/mcp.ts',
])

function main(): void {
  const files = getKnipFiles()
  const buckets = {
    binaryEntrypoint: [] as string[],
    safeDelete: [] as string[],
    inExports: [] as string[],
    falsePositive: [] as Array<{ file: string; relCallers: number }>,
    featureGated: [] as string[],
  }

  for (const f of files) {
    if (BINARY_ENTRYPOINTS.has(f)) {
      buckets.binaryEntrypoint.push(f)
      continue
    }
    if (hasFeatureGate(f)) {
      buckets.featureGated.push(f)
      continue
    }
    if (isInPackageExports(f)) {
      buckets.inExports.push(f)
      continue
    }
    const relCallers = hasRelativeCallers(f)
    if (relCallers > 0) {
      buckets.falsePositive.push({ file: f, relCallers })
      continue
    }
    buckets.safeDelete.push(f)
  }

  const md = [
    '# Knip Unused-File Classification',
    '',
    `Generated by \`bun scripts/audit-knip-unused.ts\` on ${new Date().toISOString().slice(0, 10)}.`,
    `Total unused files reported by knip: ${files.length}.`,
    '',
    '## Categories',
    '',
    `- **Binary entrypoint** (${buckets.binaryEntrypoint.length}): the literal program entry, never deletable`,
    `- **Safe-to-delete** (${buckets.safeDelete.length}): no callers via any path, not in package.json#exports`,
    `- **In package exports** (${buckets.inExports.length}): preserves public API even with no current callers`,
    `- **Knip false positive** (${buckets.falsePositive.length}): knip missed an intra-package relative import`,
    `- **Feature-gated** (${buckets.featureGated.length}): path matches a known feature flag — preserve per memory feedback_never_delete_feature_flags`,
    '',
    '## (a) Safe-to-delete',
    '',
    'Verify with `git grep <basename>` before deleting each one. ALWAYS run `bun test` after any delete (see memory feedback_knip_relative_import_blindspot).',
    '',
    ...buckets.safeDelete.map(f => `- \`${f}\``),
    '',
    '## (b) Preserved by package.json#exports',
    '',
    "These files have no in-tree callers but ARE published as part of the package's public API.",
    'Deletion would be a breaking change for any external code that imports them.',
    '',
    ...buckets.inExports.map(f => `- \`${f}\``),
    '',
    '## (c) Knip false positives (relative-import callers)',
    '',
    'Knip only tracks cross-workspace imports. These files ARE used via `./X.js`-style relative imports in their own package.',
    '',
    ...buckets.falsePositive.map(
      ({ file, relCallers }) =>
        `- \`${file}\` — ${relCallers} relative caller(s)`,
    ),
    '',
    '## (d) Feature-gated (preserve per project policy)',
    '',
    'These paths look like they belong to a feature flag subsystem. Per `feedback_never_delete_feature_flags.md`, never delete feature-flag scaffolding without operator approval.',
    '',
    ...buckets.featureGated.map(f => `- \`${f}\``),
    '',
  ].join('\n')

  writeFileSync('docs/refactor/knip-unused-classification.md', md)
  console.log(
    `Wrote docs/refactor/knip-unused-classification.md`,
  )
  console.log(
    `  safe-delete=${buckets.safeDelete.length}, in-exports=${buckets.inExports.length}, false-pos=${buckets.falsePositive.length}, feature-gated=${buckets.featureGated.length}`,
  )
}

main()
