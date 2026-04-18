#!/usr/bin/env bun
/**
 * verify-anti-patterns.ts — L4 scanner for V7 anti-patterns.
 *
 * Rules enforced (all derived from V7 §3.8 / §6.5 / §7.2):
 *
 *   A. No `error.message.includes / .match / .indexOf / .startsWith` and
 *      no `err.message === 'literal'` anywhere in packages/ (§3.8). Host
 *      rendering code in src/ is tolerated for now but capped by a
 *      decreasing budget (see ANTI_PATTERN_BUDGETS below).
 *
 *   B. No import of `src/state/AppState*` from any formal package.
 *      AppState is a transition artifact per §7.2 and must never leak
 *      into owner packages.
 *
 *   C. No direct `process.env.*` READ in core-domain packages (agent,
 *      provider, permission, memory). Core domain must go through the
 *      `config` package. Writes are still allowed (some packages shape
 *      env for subprocesses — shell, for example).
 *
 *   D. No EventEmitter in agent/provider/output/mcp-runtime (§6.5 says
 *      AsyncIterable is the only legal stream type — EventEmitter has
 *      no backpressure).
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join, relative, sep } from 'path'

const REPO_ROOT = process.cwd()
const PACKAGES_ROOT = join(REPO_ROOT, 'packages')

// Budgets for host-rendering code in src/ that still uses error.message
// comparisons. These ratchet downward — see verify-ratchet.ts. Listed here
// because Rule A wants a soft landing zone before full §14.5 enforcement.
const HOST_STRING_ERROR_BUDGET = 70 // current count of src/ host-layer hits

const CORE_DOMAIN_PACKAGES = new Set([
  'packages/agent',
  'packages/provider',
  'packages/permission',
  'packages/memory',
])

const STREAM_OWNER_PACKAGES = new Set([
  'packages/agent',
  'packages/provider',
  'packages/output',
  'packages/mcp-runtime',
])

type Violation = {
  file: string
  line: number
  snippet: string
  rule: string
}

async function walkTsTsx(root: string): Promise<string[]> {
  let out: string[] = []
  let entries: string[]
  try { entries = await readdir(root) } catch { return out }
  for (const name of entries) {
    if (name === 'node_modules' || name === 'dist' || name === '.turbo') continue
    const full = join(root, name)
    let s
    try { s = await stat(full) } catch { continue }
    if (s.isDirectory()) {
      out = out.concat(await walkTsTsx(full))
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Walk lines and run per-line matchers. Line comments (`//`) and block
 * comments are handled by the matchers themselves via heuristics (they
 * check for code-like context). Block-comment false positives are
 * tolerated — the cost is a small number of nuisance hits, vs the risk
 * of buggy comment-stripping hiding real violations.
 *
 * V7-EXEMPT-tagged lines are skipped entirely (validated separately by
 * verify-exemptions.ts).
 */
type Matcher = (line: string, file: string) => string | null

function scanFile(content: string, file: string, matchers: Matcher[]): Violation[] {
  const rawLines = content.split('\n')
  const out: Violation[] = []
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]!
    if (raw.includes('V7-EXEMPT')) continue
    // skip pure-comment lines (leading whitespace + // or *)
    const trimmed = raw.trimStart()
    if (trimmed.startsWith('//')) continue
    if (trimmed.startsWith('*') && !trimmed.startsWith('*=')) continue
    if (trimmed.startsWith('/*')) continue
    for (const m of matchers) {
      const rule = m(raw, file)
      if (rule) {
        out.push({ file, line: i + 1, snippet: raw.trim().slice(0, 120), rule })
      }
    }
  }
  return out
}

// --- Matchers --------------------------------------------------------------

// Match only identifiers that are conventionally Error bindings. This
// avoids false positives on unrelated `.message` fields (e.g.
// `input.message`, `chatMessage.message`, mailbox messages).
const ERROR_IDENT = '(err|error|e|ex|exc|cause|reason|thrown)'

const RULE_A_MATCHER: Matcher = (line) => {
  const s = `\\b${ERROR_IDENT}\\.message`
  if (new RegExp(`${s}\\.(includes|match|indexOf|startsWith|endsWith)\\s*\\(`).test(line))
    return 'V7 §3.8 — error.message string match forbidden'
  if (new RegExp(`${s}\\s*={2,3}\\s*['"]`).test(line))
    return 'V7 §3.8 — error.message equality against string literal forbidden'
  return null
}

const RULE_B_MATCHER: Matcher = (line) => {
  if (/from\s+['"][^'"]*src\/state\/AppState/.test(line))
    return 'V7 §7.2 — AppState import forbidden in packages'
  return null
}

const RULE_C_MATCHER: Matcher = (line) => {
  // process.env.FOO or process.env['FOO'] READS. We use a crude heuristic:
  // any `process.env.` access is flagged unless it is a WRITE:
  //   process.env.FOO = 'x'
  //   process.env['FOO'] = 'x'
  if (!/\bprocess\.env\b/.test(line)) return null
  // allow pure writes: `process.env.FOO = ...`
  if (/\bprocess\.env\.[A-Z_][A-Z0-9_]*\s*=[^=]/.test(line)) return null
  if (/\bprocess\.env\[['"][^'"]+['"]\]\s*=[^=]/.test(line)) return null
  return 'V7 §8.6 — core-domain package must go through config for env access'
}

const RULE_D_MATCHER: Matcher = (line) => {
  if (/\bnew\s+EventEmitter\b/.test(line))
    return 'V7 §6.5 — EventEmitter forbidden in stream-owning packages (no backpressure)'
  if (/from\s+['"]node:events['"]/.test(line))
    return 'V7 §6.5 — node:events forbidden in stream-owning packages'
  if (/from\s+['"]events['"]/.test(line))
    return 'V7 §6.5 — events forbidden in stream-owning packages'
  return null
}

// --- Main ------------------------------------------------------------------

async function ruleAInSrcHostLayer(): Promise<number> {
  // Soft rule: count current src/ host-layer hits. If it exceeds the budget,
  // the ratchet verifier will catch it; here we just report the number.
  const srcRoot = join(REPO_ROOT, 'src')
  const files = await walkTsTsx(srcRoot)
  let count = 0
  for (const f of files) {
    if (f.includes(`${sep}__tests__${sep}`)) continue
    if (/\.test\.(ts|tsx)$/.test(f)) continue
    const content = await readFile(f, 'utf8')
    const violations = scanFile(content, f, [RULE_A_MATCHER])
    count += violations.length
  }
  return count
}

async function main(): Promise<void> {
  const packageDirs = await readdir(PACKAGES_ROOT)
  const violations: Violation[] = []

  for (const pkg of packageDirs) {
    const pkgPath = join(PACKAGES_ROOT, pkg)
    const pkgRel = relative(REPO_ROOT, pkgPath)
    let s
    try { s = await stat(pkgPath) } catch { continue }
    if (!s.isDirectory()) continue

    // unwrap @ant
    const roots: string[] = []
    if (pkg === '@ant') {
      for (const sub of await readdir(pkgPath)) {
        const antSub = join(pkgPath, sub)
        const antStat = await stat(antSub)
        if (antStat.isDirectory()) roots.push(antSub)
      }
    } else {
      roots.push(pkgPath)
    }

    for (const root of roots) {
      const rootRel = relative(REPO_ROOT, root)
      const files = await walkTsTsx(root)

      const matchers: Matcher[] = [RULE_A_MATCHER, RULE_B_MATCHER]
      // Rule C: only core domain
      if (CORE_DOMAIN_PACKAGES.has(rootRel)) matchers.push(RULE_C_MATCHER)
      // Rule D: only stream owners
      if (STREAM_OWNER_PACKAGES.has(rootRel)) matchers.push(RULE_D_MATCHER)

      for (const file of files) {
        if (/\.test\.(ts|tsx)$/.test(file)) continue
        if (file.includes(`${sep}__tests__${sep}`)) continue
        const content = await readFile(file, 'utf8')
        violations.push(...scanFile(content, file, matchers))
      }
    }
  }

  // Budget report for src/ host layer (soft, tracked by ratchet)
  const srcHostHits = await ruleAInSrcHostLayer()
  console.log(`src/ host-layer string error comparisons: ${srcHostHits} (budget ${HOST_STRING_ERROR_BUDGET})`)
  if (srcHostHits > HOST_STRING_ERROR_BUDGET) {
    violations.push({
      file: '(ratchet)',
      line: 0,
      snippet: '',
      rule: `V7 §14.5 — src/ host-layer string error comparisons ${srcHostHits} > budget ${HOST_STRING_ERROR_BUDGET}`,
    })
  }

  if (violations.length > 0) {
    const byRule = new Map<string, Violation[]>()
    for (const v of violations) {
      const list = byRule.get(v.rule) ?? []
      list.push(v)
      byRule.set(v.rule, list)
    }
    for (const [rule, list] of byRule) {
      console.error(`\n${rule} (${list.length} violations)`)
      for (const v of list.slice(0, 10)) {
        const loc = v.line > 0 ? `:${v.line}` : ''
        console.error(`  ${relative(REPO_ROOT, v.file)}${loc}  ${v.snippet}`)
      }
      if (list.length > 10) console.error(`  ... and ${list.length - 10} more`)
    }
    throw new Error(`${violations.length} anti-pattern violations`)
  }

  console.log('anti-pattern verification passed')
}

await main()
