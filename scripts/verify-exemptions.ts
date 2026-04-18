#!/usr/bin/env bun
/**
 * verify-exemptions.ts — L6 enforcement of V7 §13.2 exemption mechanism.
 *
 * Format (as defined by V7 §13.2):
 *   V7-EXEMPT(id=<slug>, reason="<one-line reason>", expires=<ISO date>, owner=@<handle>)
 *
 * Rules:
 *   - Every exemption must parse cleanly (all 4 fields present).
 *   - `expires` must be a valid ISO date and at most 14 days from today.
 *   - `id` must be globally unique across the repo.
 *   - At most 5 active exemptions per doctor check id.
 *   - Non-negotiable violations cannot be exempted (see BANNED_EXEMPT_CATEGORIES).
 *
 * Output: prints the active exemption table and fails on any rule violation.
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join, relative, sep } from 'path'

const REPO_ROOT = process.cwd()
const MAX_EXEMPT_DAYS = 14
const MAX_PER_CATEGORY = 5

// V7 §13.2 "Exemption 不適用於" — these categories are non-negotiable.
const BANNED_EXEMPT_CATEGORIES = new Set([
  'external-cli-compat',     // §12 外部 CLI 相容性
  'cc-app-ban',              // §17 @cc-app import ban
  'observability-policy',    // §3.6 本地可插拔 observability
  'strict-sequencing',       // §10.4 Wave entry gate
  'core-to-host-reverse',    // Core Domain → App Host 反向依賴
  'wave-entry-gate',         // §10.4 任一 Wave Entry Gate 檢查
])

const EXEMPT_RE =
  /V7-EXEMPT\s*\(\s*id\s*=\s*([^,)]+?)\s*,\s*reason\s*=\s*["']([^"']+)["']\s*,\s*expires\s*=\s*(\d{4}-\d{2}-\d{2})\s*,\s*owner\s*=\s*@([^\s,)]+)\s*\)/g

type Exemption = {
  file: string
  line: number
  id: string
  reason: string
  expires: string
  owner: string
  category?: string   // derived from id prefix, e.g. `cc-app-ban-...`
}

async function walkAll(root: string): Promise<string[]> {
  let out: string[] = []
  let entries: string[]
  try { entries = await readdir(root) } catch { return out }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '.turbo') continue
    if (name === '.git') continue
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

function deriveCategory(id: string): string {
  // Convention: category is the leading dash-separated slug.
  // e.g. `cc-app-ban-ink-vim-motions` → category `cc-app-ban`
  const parts = id.split('-')
  if (parts.length <= 1) return id
  // longest known category prefix wins
  for (const cat of BANNED_EXEMPT_CATEGORIES) {
    if (id.startsWith(cat + '-')) return cat
  }
  // fall back to first 2 slug tokens
  return parts.slice(0, 2).join('-')
}

async function scan(): Promise<Exemption[]> {
  const out: Exemption[] = []
  const files = [
    ...await walkAll(join(REPO_ROOT, 'src')),
    ...await walkAll(join(REPO_ROOT, 'packages')),
    ...await walkAll(join(REPO_ROOT, 'scripts')),
  ]
  // The verifier and non-negotiable-coverage files necessarily contain
  // V7-EXEMPT literal text in their docstrings as self-documentation.
  // Exclude them so the scanner doesn't parse its own examples.
  const SELF_EXCLUDES = new Set([
    join(REPO_ROOT, 'scripts', 'verify-exemptions.ts'),
    join(REPO_ROOT, 'scripts', 'verify-non-negotiable-coverage.ts'),
    join(REPO_ROOT, 'scripts', 'verify-anti-patterns.ts'),
  ])
  for (const file of files) {
    if (SELF_EXCLUDES.has(file)) continue
    if (!/\.(ts|tsx|js|mjs|json|md)$/.test(file)) continue
    const content = await readFile(file, 'utf8')
    if (!content.includes('V7-EXEMPT')) continue
    const lines = content.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      EXEMPT_RE.lastIndex = 0
      const m = EXEMPT_RE.exec(line)
      if (!m) {
        if (line.includes('V7-EXEMPT(')) {
          // malformed exemption — report
          out.push({
            file, line: i + 1,
            id: '(malformed)',
            reason: line.trim().slice(0, 120),
            expires: '',
            owner: '',
          })
        }
        continue
      }
      out.push({
        file, line: i + 1,
        id: m[1]!.trim(),
        reason: m[2]!,
        expires: m[3]!,
        owner: m[4]!,
        category: deriveCategory(m[1]!.trim()),
      })
    }
  }
  return out
}

async function main(): Promise<void> {
  const exemptions = await scan()
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  const maxExpires = new Date(today)
  maxExpires.setUTCDate(maxExpires.getUTCDate() + MAX_EXEMPT_DAYS)

  const violations: string[] = []
  const idSeen = new Map<string, Exemption>()
  const perCategory = new Map<string, number>()

  for (const ex of exemptions) {
    const loc = `${relative(REPO_ROOT, ex.file)}:${ex.line}`

    if (ex.id === '(malformed)') {
      violations.push(`${loc}: malformed V7-EXEMPT tag — "${ex.reason}"`)
      continue
    }

    // Uniqueness
    const dup = idSeen.get(ex.id)
    if (dup) {
      violations.push(`${loc}: duplicate exemption id "${ex.id}" (also at ${relative(REPO_ROOT, dup.file)}:${dup.line})`)
    } else {
      idSeen.set(ex.id, ex)
    }

    // Expires parse + bounds
    const expDate = new Date(ex.expires + 'T00:00:00Z')
    if (Number.isNaN(expDate.getTime())) {
      violations.push(`${loc}: invalid expires date "${ex.expires}"`)
    } else {
      if (expDate < today) {
        violations.push(`${loc}: exemption "${ex.id}" expired on ${ex.expires}`)
      } else if (expDate > maxExpires) {
        violations.push(`${loc}: exemption "${ex.id}" expires ${ex.expires} > 14 days from today (${today.toISOString().slice(0,10)})`)
      }
    }

    // Category bans
    if (ex.category && BANNED_EXEMPT_CATEGORIES.has(ex.category)) {
      violations.push(`${loc}: category "${ex.category}" cannot be exempted (V7 §13.2 non-negotiable)`)
    }

    // Per-category count
    if (ex.category) {
      perCategory.set(ex.category, (perCategory.get(ex.category) ?? 0) + 1)
    }
  }

  for (const [cat, n] of perCategory) {
    if (n > MAX_PER_CATEGORY) {
      violations.push(`category "${cat}" has ${n} active exemptions (max ${MAX_PER_CATEGORY})`)
    }
  }

  // Report
  if (exemptions.length === 0) {
    console.log('no active V7-EXEMPT tags found')
  } else {
    console.log(`found ${exemptions.length} active exemption(s):`)
    for (const ex of exemptions) {
      console.log(
        `  ${ex.id.padEnd(35)} expires=${ex.expires.padEnd(10)} owner=@${ex.owner.padEnd(15)} at ${relative(REPO_ROOT, ex.file)}:${ex.line}`,
      )
    }
  }

  if (violations.length > 0) {
    console.error('\nexemption violations:')
    for (const v of violations) console.error(`  ${v}`)
    throw new Error(`${violations.length} exemption violations`)
  }

  console.log('\nexemption verification passed')
}

await main()
