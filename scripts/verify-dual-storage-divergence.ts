#!/usr/bin/env bun
/**
 * verify-dual-storage-divergence — same-noun get/set / read/write /
 * register/clear pairs must not span unrelated packages.
 *
 * Ralph-loop bug class: `loadPluginHooks()` wrote to _deps.ts placeholder,
 * `agent/hooks.ts` read from app-host STATE — different storages, silent
 * for ~200 commits. This verifier prevents recurrence by flagging any
 * cross-package verb pair that's not on the V7 §11.2 host-binding allowlist.
 *
 * Allow specific pairs by adding the noun to HOST_BINDING_NAMES inside
 * scripts/audit-silent-failures/04-dual-storage-divergence.ts (the audit
 * this verifier delegates to).
 */
import { execSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const AUDIT = join(
  REPO_ROOT,
  'scripts/audit-silent-failures/04-dual-storage-divergence.ts',
)

interface Finding {
  pattern: string
  file: string
  line: number
  snippet: string
  severity: string
  note: string
}

async function main(): Promise<void> {
  const stdout = execSync(`bun ${AUDIT}`, {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  })
  const result = JSON.parse(stdout) as { findings: Finding[] }

  if (result.findings.length > 0) {
    console.error('verify-dual-storage-divergence: violations')
    for (const v of result.findings) {
      console.error(`  ${v.snippet}`)
    }
    throw new Error(
      `${result.findings.length} dual-storage pairs span unrelated packages. ` +
        `Add the noun to HOST_BINDING_NAMES if it's a designed host binding, ` +
        `or fix the divergence (this is the ralph-loop bug class).`,
    )
  }
  console.log('verify-dual-storage-divergence: clean')
}

await main()
