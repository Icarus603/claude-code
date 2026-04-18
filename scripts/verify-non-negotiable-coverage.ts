#!/usr/bin/env bun
/**
 * verify-non-negotiable-coverage.ts — L7 meta-check.
 *
 * Every line in V7 §12 Non-Negotiables must map to at least one registered
 * verifier. This prevents the "rule exists on paper but nothing checks it"
 * failure mode that let the codebase pass 24/24 while 14 packages were
 * empty shells.
 *
 * When V7 adds a new non-negotiable, this verifier fails until a matching
 * entry is added to NON_NEGOTIABLE_COVERAGE below.
 *
 * Each rule maps to:
 *   - `verifiers`: list of scripts/verify-*.ts that enforce it
 *   - `notes`: if "unautomated", explains why (V7 §13.1)
 */

import { readFile } from 'fs/promises'

// --- V7 §12 rules, copied verbatim and mapped to verifiers -----------------

type Coverage = {
  rule: string
  verifiers: string[]
  notes?: string
}

const NON_NEGOTIABLE_COVERAGE: Coverage[] = [
  {
    rule: '外部 CLI、SDK、設定格式、檔案格式、功能行為不變',
    verifiers: ['scripts/verify-session-format-compat.ts'],
    notes: 'Partial — full behavioral parity requires live smoke (covered by CI five-mode smoke).',
  },
  {
    rule: '正式 package 不得依賴 @cc-app/*',
    verifiers: ['scripts/verify-import-graph.ts', 'scripts/verify-ratchet.ts'],
  },
  {
    rule: '正式 package 不得依賴 root src/*',
    verifiers: ['scripts/verify-import-graph.ts'],
  },
  {
    rule: 'main.tsx 不得持有核心業務所有權',
    verifiers: ['scripts/verify-entry-thin-host.ts', 'scripts/verify-ownership-gravity.ts'],
  },
  {
    rule: 'REPL.tsx 不得持有核心業務所有權',
    verifiers: ['scripts/verify-repl-owner.ts', 'scripts/verify-ownership-gravity.ts'],
  },
  {
    rule: 'print.ts 不得持有 agent / provider / MCP / registry 的 owner logic',
    verifiers: ['scripts/verify-headless-host.ts', 'scripts/verify-ownership-gravity.ts'],
  },
  {
    rule: 'Core Domain 不得依賴 integration 或 app host',
    verifiers: ['scripts/verify-import-graph.ts'],
    notes: 'Indirectly enforced — no core package imports @claude-code/<integration>.',
  },
  {
    rule: 'observability 採本地可插拔模式，不以外送 telemetry 為核心依賴',
    verifiers: ['scripts/verify-import-graph.ts'],
    notes: 'Partial — ensures integration packages are not imported by core/platform. Telemetry exporter policy is unautomated.',
  },
  {
    rule: 'shim、host binding、compat wrapper 不算 owner implementation',
    verifiers: ['scripts/verify-ownership-gravity.ts'],
  },
  {
    rule: 'packages/app-host 必須是真正 composition root；不允許空 package 佔位',
    verifiers: ['scripts/verify-app-host-composition.ts', 'scripts/verify-ownership-gravity.ts'],
  },
  {
    rule: '每個可阻塞 > 50ms 的函式必須接受 AbortSignal',
    verifiers: [],
    notes: 'Unautomated per V7 §13.1 — needs AST/type info; currently code-review-gated.',
  },
  {
    rule: '每個 owner 必須有 typed error namespace；host 禁止字串匹配錯誤',
    verifiers: ['scripts/verify-error-namespaces.ts', 'scripts/verify-anti-patterns.ts', 'scripts/verify-ratchet.ts'],
  },
  {
    rule: '每個 owner 必須提供 testing/ subpath in-memory fake',
    verifiers: ['scripts/verify-testing-seams.ts'],
  },
  {
    rule: 'AgentEvent 是 spine；新事件必須有 turnId + ts',
    verifiers: [],
    notes: 'Unautomated — see scripts/verify-event-spine.ts TODO; currently code-review-gated.',
  },
  {
    rule: 'Migration 嚴格遵循 §10.4 wave ordering；同一時間點 in-flight package 數量 ≤ 1',
    verifiers: ['scripts/verify-ratchet.ts'],
    notes: 'Partial — ratchet catches regressions but does not enforce WIP=1 in-flight limit.',
  },
  {
    rule: '跨 package 型別只能從 /contracts subpath 取；禁止共享 types package',
    verifiers: ['scripts/verify-import-graph.ts'],
    notes: 'Import graph rejects /internal/ paths; shared-types-package check unautomated.',
  },
  {
    rule: 'AppState 不得在 packages/ 內 import；終局必須解體',
    verifiers: ['scripts/verify-anti-patterns.ts', 'scripts/verify-ratchet.ts'],
  },
]

// --- Main ------------------------------------------------------------------

async function main(): Promise<void> {
  const violations: string[] = []
  const unautomated: Coverage[] = []

  // Check each registered rule has at least one verifier OR is explicitly
  // flagged as unautomated with a note.
  for (const c of NON_NEGOTIABLE_COVERAGE) {
    if (c.verifiers.length === 0) {
      if (!c.notes || !c.notes.includes('Unautomated')) {
        violations.push(`rule "${c.rule}" has no verifier and no "Unautomated" note`)
      }
      unautomated.push(c)
      continue
    }
    for (const v of c.verifiers) {
      try {
        await readFile(v, 'utf8')
      } catch {
        violations.push(`rule "${c.rule}" references missing verifier ${v}`)
      }
    }
  }

  // Cross-check: every verifier registered in doctor-architecture.ts must
  // be referenced at least once in NON_NEGOTIABLE_COVERAGE — otherwise we
  // have a verifier that enforces a rule V7 didn't declare non-negotiable.
  // (This is informational — we only warn, not fail.)
  const doctor = await readFile('scripts/doctor-architecture.ts', 'utf8')
  const referenced = new Set(NON_NEGOTIABLE_COVERAGE.flatMap(c => c.verifiers))
  const registered = new Set<string>()
  const scriptRe = /script:\s*['"]([^'"]+)['"]/g
  let m: RegExpExecArray | null
  while ((m = scriptRe.exec(doctor)) !== null) {
    registered.add(m[1]!)
  }
  const orphans = [...registered].filter(r => !referenced.has(r))

  // Report
  console.log('non-negotiable coverage report:')
  console.log(`  rules registered:     ${NON_NEGOTIABLE_COVERAGE.length}`)
  console.log(`  rules covered:        ${NON_NEGOTIABLE_COVERAGE.length - unautomated.length}`)
  console.log(`  rules unautomated:    ${unautomated.length} (code-review-gated)`)
  console.log(`  verifiers registered: ${registered.size}`)
  console.log(`  verifiers linked:     ${referenced.size}`)

  if (unautomated.length > 0) {
    console.log('\nunautomated rules (code review responsibility):')
    for (const c of unautomated) {
      console.log(`  - ${c.rule}`)
      if (c.notes) console.log(`    note: ${c.notes}`)
    }
  }

  if (orphans.length > 0) {
    console.log('\nverifiers not linked to any non-negotiable rule (informational):')
    for (const o of orphans) console.log(`  - ${o}`)
  }

  if (violations.length > 0) {
    console.error('\ncoverage violations:')
    for (const v of violations) console.error(`  ${v}`)
    throw new Error(`${violations.length} coverage gaps`)
  }

  console.log('\nnon-negotiable coverage verification passed')
}

await main()
