#!/usr/bin/env bun
/**
 * verify-ratchet.ts — L5 one-way monotonicity enforcement.
 *
 * A ratchet is a set of metrics that should only ever decrease during V7
 * migration. Each metric has a baseline stored in `scripts/ratchet-baseline.json`.
 * CI fails if a metric increases past its baseline.
 *
 * When a metric drops (good!), run `bun run scripts/verify-ratchet.ts --tighten`
 * to burn in the new lower value as the baseline.
 *
 * Current ratchets (all derived from V7 §14 Definition of Done):
 *
 *   - appstate_imports:    files importing AppState from src/state/AppState*
 *     (§7.2 — AppState should dissolve; lower is better)
 *
 *   - src_components_files: count of .tsx/.ts files in src/components/
 *     (§8.24 — should split across repl/permission/tool-registry/@ant-ink)
 *
 *   - src_commands_subdirs: count of subdirectories in src/commands/
 *     (§10.1 — each subcommand should migrate to its integration owner)
 *
 *   - src_services_api_files: count of .ts files in src/services/api/
 *     (§10.3 — provider package is the final owner)
 *
 *   - src_services_mcp_files: count of .ts files in src/services/mcp/
 *     (§10.3 — mcp-runtime is the final owner)
 *
 *   - src_tools_subdirs: count of tool directories in src/tools/
 *     (§8.7 — tool-registry is the final owner)
 *
 *   - cc_app_imports: total `@cc-app/*` + `@claude-code/app-compat/*`
 *     references across the entire repo (§17 — should reach 0)
 *
 *   - host_string_error_cmp: `err.message.includes(...)` style in src/
 *     (§14.5 — should reach 0)
 *
 * Baselines are burned-in on first run if the file doesn't exist.
 */

import { readdir, readFile, writeFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join, sep } from 'path'

const REPO_ROOT = process.cwd()
const BASELINE_FILE = join(REPO_ROOT, 'scripts', 'ratchet-baseline.json')

type Ratchet = {
  id: string
  description: string
  doc: string
  measure: () => Promise<number>
}

async function walkAll(root: string): Promise<string[]> {
  let out: string[] = []
  let entries: string[]
  try { entries = await readdir(root) } catch { return out }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '.turbo') continue
    const full = join(root, name)
    let s
    try { s = await stat(full) } catch { continue }
    if (s.isDirectory()) {
      out = out.concat(await walkAll(full))
    } else {
      out.push(full)
    }
  }
  return out
}

async function countMatches(
  rootDirs: string[],
  pattern: RegExp,
  fileFilter: (f: string) => boolean = () => true,
): Promise<number> {
  let total = 0
  for (const root of rootDirs) {
    for (const file of await walkAll(root)) {
      if (!fileFilter(file)) continue
      const content = await readFile(file, 'utf8')
      const matches = content.match(pattern)
      if (matches) total += matches.length
    }
  }
  return total
}

async function countFilesImporting(
  rootDirs: string[],
  importPattern: RegExp,
  fileFilter: (f: string) => boolean = () => true,
): Promise<number> {
  let count = 0
  for (const root of rootDirs) {
    for (const file of await walkAll(root)) {
      if (!fileFilter(file)) continue
      const content = await readFile(file, 'utf8')
      if (importPattern.test(content)) count++
    }
  }
  return count
}

async function countSubdirs(root: string): Promise<number> {
  try {
    const entries = await readdir(root)
    let count = 0
    for (const e of entries) {
      const s = await stat(join(root, e))
      if (s.isDirectory()) count++
    }
    return count
  } catch {
    return 0
  }
}

async function countFilesMatchingExt(
  root: string,
  extRe: RegExp,
): Promise<number> {
  const files = await walkAll(root)
  return files.filter(f => extRe.test(f)).length
}

const isTsTsx = (f: string) =>
  /\.(ts|tsx)$/.test(f) &&
  !f.includes(`${sep}__tests__${sep}`) &&
  !/\.test\.(ts|tsx)$/.test(f)

const RATCHETS: Ratchet[] = [
  {
    id: 'appstate_imports',
    description: 'Files importing AppState from src/state/AppState*',
    doc: 'V7 §7.2',
    measure: () =>
      countFilesImporting(
        [join(REPO_ROOT, 'src'), join(REPO_ROOT, 'packages')],
        /from\s+['"][^'"]*src\/state\/AppState/,
        isTsTsx,
      ),
  },
  // 6 src_* ratchets removed — src/ has been completely evacuated and these
  // metrics measured a path that no longer exists, so they would forever
  // return 0 (the catch fallback) regardless of regression. Removing them
  // is a hygiene fix, not a relaxation: an empty src/ already satisfied them.
  {
    id: 'cc_app_imports',
    description: 'Total @cc-app/ + @claude-code/app-compat/ references',
    doc: 'V7 §17 (target: 0)',
    measure: () =>
      countMatches(
        [join(REPO_ROOT, 'src'), join(REPO_ROOT, 'packages')],
        /@(cc-app|claude-code\/app-compat)\//g,
        f => /\.(ts|tsx|js|mjs)$/.test(f),
      ),
  },
  {
    id: 'host_string_error_cmp',
    description: '`err.message.includes()` style across packages/ (V7 §14.5 target: 0)',
    doc: 'V7 §14.5',
    measure: () =>
      countMatches(
        [join(REPO_ROOT, 'packages')],
        /\b(err|error|e|ex|exc|cause|reason)\.message\.(includes|match|indexOf|startsWith|endsWith)\s*\(/g,
        isTsTsx,
      ),
  },
  // src_agent_depimpls removed — measured src/agent/ which no longer exists.
  {
    id: 'empty_shell_packages',
    description: 'Packages with < 200 non-skeleton owner LOC (§3.1 shims)',
    doc: 'V7 §3.1',
    measure: async () => {
      // reuse gravity logic: walk each listed subsystem package
      const { SUBSYSTEM_MIRRORS } = await import('./ownership-gravity-map.js')
      let empty = 0
      for (const entry of SUBSYSTEM_MIRRORS) {
        let lines = 0
        for (const file of await walkAll(join(REPO_ROOT, entry.ownerPackage))) {
          if (!isTsTsx(file)) continue
          const base = file.split(sep).pop() ?? ''
          if (['contracts.ts', 'errors.ts', 'index.ts'].includes(base)) continue
          if (file.includes(`${sep}types${sep}`) || file.includes(`${sep}testing${sep}`)) continue
          const content = await readFile(file, 'utf8')
          for (const raw of content.split('\n')) {
            const t = raw.trim()
            if (!t) continue
            if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
            lines++
          }
        }
        if (lines < 200) empty++
      }
      return empty
    },
  },
]

// --- Main ------------------------------------------------------------------

type Baseline = Record<string, number>

async function loadBaseline(): Promise<Baseline> {
  if (!existsSync(BASELINE_FILE)) return {}
  return JSON.parse(await readFile(BASELINE_FILE, 'utf8'))
}

async function saveBaseline(b: Baseline): Promise<void> {
  await writeFile(BASELINE_FILE, JSON.stringify(b, null, 2) + '\n')
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2))
  const tighten = args.has('--tighten')
  const burnIn = args.has('--burn-in')

  const baseline = await loadBaseline()
  const measured: Baseline = {}
  const violations: string[] = []
  const improvements: string[] = []

  for (const r of RATCHETS) {
    const current = await r.measure()
    measured[r.id] = current
    const prev = baseline[r.id]

    if (prev === undefined) {
      if (burnIn) {
        improvements.push(`  [burn-in] ${r.id} = ${current} (new baseline)`)
      } else {
        violations.push(`  ${r.id}: no baseline yet (${r.description}); run with --burn-in`)
      }
      continue
    }
    if (current > prev) {
      violations.push(
        `  ${r.id}: ${current} > baseline ${prev} (regressed by ${current - prev}) — ${r.doc}`,
      )
    } else if (current < prev) {
      improvements.push(`  ${r.id}: ${current} < baseline ${prev} (reduced by ${prev - current})`)
    }
  }

  console.log('ratchet report:')
  for (const r of RATCHETS) {
    const current = measured[r.id]!
    const prev = baseline[r.id]
    const delta =
      prev === undefined ? '(new)' :
      current > prev ? `↑ +${current - prev}` :
      current < prev ? `↓ -${prev - current}` :
      '='
    console.log(`  ${r.id.padEnd(28)} ${String(current).padStart(6)}  ${delta}`)
  }

  if (improvements.length > 0) {
    console.log('\nimprovements since last baseline:')
    for (const imp of improvements) console.log(imp)
  }

  if (tighten || burnIn) {
    await saveBaseline(measured)
    console.log(`\nbaseline updated → ${BASELINE_FILE}`)
    return
  }

  if (violations.length > 0) {
    console.error('\nratchet violations (migration regressed):')
    for (const v of violations) console.error(v)
    throw new Error(
      `${violations.length} ratchet regressions. If intentional, justify in PR description; otherwise revert.`,
    )
  }

  // Encourage tightening when improvements are sitting around.
  if (improvements.length > 0 && !tighten) {
    console.log('\nNote: run with --tighten to commit the reduced values as new baseline.')
  }

  console.log('\nratchet verification passed')
}

await main()
