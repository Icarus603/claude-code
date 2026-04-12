#!/usr/bin/env bun
/**
 * doctor:arch — single, composable runner for every architectural rule
 * check in `scripts/verify-*.ts`. The output mirrors V7.md's layer model so
 * any failure maps directly to a named subsystem / section of the doc.
 *
 * Rules live in verify-*.ts scripts (one check per script, exits non-zero on
 * violation). This runner spawns each script as a subprocess so failures are
 * isolated and the runner itself stays architecture-agnostic (zero imports
 * from the packages it is grading).
 *
 * Usage:
 *   bun run doctor:arch                 # run all checks, print summary
 *   bun run doctor:arch --only agent    # run checks whose id contains "agent"
 *   bun run doctor:arch --list          # list registered checks and exit
 *   bun run doctor:arch --json          # machine-readable output (for CI)
 *   bun run doctor:arch --verbose       # stream each check's stdout/stderr
 *
 * Exit code: 0 on all pass, 1 on any failure, 2 on runner error.
 */

import { spawn } from 'bun'
import { existsSync } from 'fs'

type Layer =
  | 'Core Domain'
  | 'Platform Runtime'
  | 'Integrations'
  | 'App Hosts'
  | 'Cross-Cutting'

type Check = {
  id: string
  layer: Layer
  subsystem: string
  script: string
  doc: string
}

// Single source of truth for every architectural rule we know how to check.
// When you add a new verify-*.ts, register it here so doctor:arch picks it up.
const CHECKS: Check[] = [
  // ── Core Domain ────────────────────────────────────────────────────────
  {
    id: 'agent-owner',
    layer: 'Core Domain',
    subsystem: 'agent',
    script: 'scripts/verify-agent-owner.ts',
    doc: 'V7 §8.2 / §10',
  },
  {
    id: 'provider-owner',
    layer: 'Core Domain',
    subsystem: 'provider',
    script: 'scripts/verify-provider-owner.ts',
    doc: 'V7 §8.3 / §10',
  },
  {
    id: 'provider-adapter',
    layer: 'Core Domain',
    subsystem: 'provider',
    script: 'scripts/verify-provider-adapter.ts',
    doc: 'V7 §8.3 / §9.3',
  },

  // ── Platform Runtime ──────────────────────────────────────────────────
  {
    id: 'command-registry',
    layer: 'Platform Runtime',
    subsystem: 'command-runtime',
    script: 'scripts/verify-command-registry.ts',
    doc: 'V7 §8.8 / §10',
  },
  {
    id: 'shell-package',
    layer: 'Platform Runtime',
    subsystem: 'shell',
    script: 'scripts/verify-shell-package.ts',
    doc: 'V7 §8.9',
  },
  {
    id: 'storage-contracts',
    layer: 'Platform Runtime',
    subsystem: 'storage',
    script: 'scripts/verify-storage-contracts.ts',
    doc: 'V7 §8.10 / §9.7',
  },
  {
    id: 'output-targets',
    layer: 'Platform Runtime',
    subsystem: 'output',
    script: 'scripts/verify-output-targets.ts',
    doc: 'V7 §8.11 / §9.8',
  },

  // ── Integrations ──────────────────────────────────────────────────────
  {
    id: 'mcp-runtime',
    layer: 'Integrations',
    subsystem: 'mcp',
    script: 'scripts/verify-mcp-runtime.ts',
    doc: 'V7 §8.13',
  },
  {
    id: 'swarm-e2e',
    layer: 'Integrations',
    subsystem: 'swarm',
    script: 'scripts/verify-swarm-e2e.ts',
    doc: 'V7 §8.14',
  },
  {
    id: 'optional-integration-slots',
    layer: 'Integrations',
    subsystem: 'ide/teleport/updater/server',
    script: 'scripts/verify-optional-integration-slots.ts',
    doc: 'V7 §8.15–§8.18, §15',
  },

  // ── App Hosts ─────────────────────────────────────────────────────────
  {
    id: 'app-host-composition',
    layer: 'App Hosts',
    subsystem: 'app-host',
    script: 'scripts/verify-app-host-composition.ts',
    doc: 'V7 §8.1 / §9.1',
  },
  {
    id: 'cli-package',
    layer: 'App Hosts',
    subsystem: 'cli',
    script: 'scripts/verify-cli-package.ts',
    doc: 'V7 §8.19',
  },
  {
    id: 'repl-owner',
    layer: 'App Hosts',
    subsystem: 'repl',
    script: 'scripts/verify-repl-owner.ts',
    doc: 'V7 §8.20',
  },
  {
    id: 'headless-host',
    layer: 'App Hosts',
    subsystem: 'headless/sdk',
    script: 'scripts/verify-headless-host.ts',
    doc: 'V7 §8.21',
  },
  {
    id: 'entry-thin-host',
    layer: 'App Hosts',
    subsystem: 'app-host',
    script: 'scripts/verify-entry-thin-host.ts',
    doc: 'V7 §12 (Non-Negotiables)',
  },

  // ── Cross-Cutting rules that span many subsystems ─────────────────────
  {
    id: 'runtime-boundaries',
    layer: 'Cross-Cutting',
    subsystem: 'dependency rules',
    script: 'scripts/verify-runtime-boundaries.ts',
    doc: 'V7 §11 / §12',
  },
  {
    id: 'app-state-boundaries',
    layer: 'Cross-Cutting',
    subsystem: 'state ownership',
    script: 'scripts/verify-app-state-boundaries.ts',
    doc: 'V7 §7',
  },
  {
    id: 'appstate-domain-api',
    layer: 'Cross-Cutting',
    subsystem: 'state ownership',
    script: 'scripts/verify-appstate-domain-api.ts',
    doc: 'V7 §7.2',
  },
  {
    id: 'session-format-compat',
    layer: 'Cross-Cutting',
    subsystem: 'external contract',
    script: 'scripts/verify-session-format-compat.ts',
    doc: 'V7 §4',
  },
  {
    id: 'gates',
    layer: 'Cross-Cutting',
    subsystem: 'feature gates',
    script: 'scripts/verify-gates.ts',
    doc: 'V7 §3.6',
  },
  {
    id: 'empty-folders',
    layer: 'Cross-Cutting',
    subsystem: 'wave-0 hygiene',
    script: 'scripts/verify-empty-folders.ts',
    doc: 'V7 §19.5',
  },
]

type CheckResult = {
  check: Check
  status: 'pass' | 'fail' | 'missing'
  durationMs: number
  stdout: string
  stderr: string
  exitCode: number | null
}

async function runCheck(check: Check, verbose: boolean): Promise<CheckResult> {
  const started = performance.now()

  if (!existsSync(check.script)) {
    return {
      check,
      status: 'missing',
      durationMs: 0,
      stdout: '',
      stderr: `script not found: ${check.script}`,
      exitCode: null,
    }
  }

  const proc = spawn({
    cmd: ['bun', 'run', check.script],
    stdout: verbose ? 'inherit' : 'pipe',
    stderr: verbose ? 'inherit' : 'pipe',
  })

  const stdout = verbose ? '' : await new Response(proc.stdout).text()
  const stderr = verbose ? '' : await new Response(proc.stderr).text()
  const exitCode = await proc.exited

  return {
    check,
    status: exitCode === 0 ? 'pass' : 'fail',
    durationMs: Math.round(performance.now() - started),
    stdout,
    stderr,
    exitCode,
  }
}

function parseArgs(argv: string[]) {
  const args = {
    list: false,
    json: false,
    verbose: false,
    only: null as string | null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--list') args.list = true
    else if (a === '--json') args.json = true
    else if (a === '--verbose' || a === '-v') args.verbose = true
    else if (a === '--only') args.only = argv[++i] ?? null
    else if (a === '--help' || a === '-h') {
      console.log(`doctor:arch — architectural rule runner

  bun run doctor:arch                 run every registered check
  bun run doctor:arch --only <id>     run checks whose id contains <id>
  bun run doctor:arch --list          list registered checks and exit
  bun run doctor:arch --json          machine-readable output
  bun run doctor:arch --verbose       stream each check's stdout/stderr
`)
      process.exit(0)
    }
  }
  return args
}

function prettyPrint(results: CheckResult[]) {
  const icon = (s: CheckResult['status']) =>
    s === 'pass' ? '✓' : s === 'fail' ? '✗' : '?'
  const color = (s: CheckResult['status']) =>
    s === 'pass' ? '\x1b[32m' : s === 'fail' ? '\x1b[31m' : '\x1b[33m'
  const reset = '\x1b[0m'
  const dim = '\x1b[2m'

  const byLayer = new Map<Layer, CheckResult[]>()
  for (const r of results) {
    const list = byLayer.get(r.check.layer) ?? []
    list.push(r)
    byLayer.set(r.check.layer, list)
  }

  const layerOrder: Layer[] = [
    'Core Domain',
    'Platform Runtime',
    'Integrations',
    'App Hosts',
    'Cross-Cutting',
  ]

  console.log()
  console.log('  doctor:arch — architecture rule status')
  console.log(`  ${'─'.repeat(56)}`)

  for (const layer of layerOrder) {
    const group = byLayer.get(layer)
    if (!group || group.length === 0) continue
    console.log(`\n  ${layer}`)
    for (const r of group) {
      const id = r.check.id.padEnd(32)
      const sub = r.check.subsystem.padEnd(22)
      const dur = `${r.durationMs}ms`.padStart(7)
      console.log(
        `    ${color(r.status)}${icon(r.status)}${reset} ${id} ${dim}${sub}${reset} ${dim}${dur}${reset}`,
      )
      if (r.status !== 'pass') {
        const msg = (r.stderr || r.stdout).trim().split('\n').slice(0, 6)
        for (const line of msg) {
          console.log(`        ${dim}${line}${reset}`)
        }
        console.log(`        ${dim}→ ${r.check.doc} (${r.check.script})${reset}`)
      }
    }
  }

  const passed = results.filter((r) => r.status === 'pass').length
  const failed = results.filter((r) => r.status === 'fail').length
  const missing = results.filter((r) => r.status === 'missing').length

  console.log()
  console.log(`  ${'─'.repeat(56)}`)
  console.log(`  ${passed} passed · ${failed} failed · ${missing} missing`)
  console.log()
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const selected = args.only
    ? CHECKS.filter((c) => c.id.includes(args.only!))
    : CHECKS

  if (args.list) {
    for (const c of selected) {
      console.log(`${c.id.padEnd(32)} ${c.layer.padEnd(18)} ${c.script}`)
    }
    return
  }

  if (selected.length === 0) {
    console.error(`no checks matched --only '${args.only}'`)
    process.exit(2)
  }

  const results: CheckResult[] = []
  for (const check of selected) {
    results.push(await runCheck(check, args.verbose))
  }

  if (args.json) {
    console.log(
      JSON.stringify(
        {
          total: results.length,
          passed: results.filter((r) => r.status === 'pass').length,
          failed: results.filter((r) => r.status === 'fail').length,
          missing: results.filter((r) => r.status === 'missing').length,
          results: results.map((r) => ({
            id: r.check.id,
            layer: r.check.layer,
            subsystem: r.check.subsystem,
            script: r.check.script,
            doc: r.check.doc,
            status: r.status,
            durationMs: r.durationMs,
            exitCode: r.exitCode,
            stderr: r.stderr.trim(),
          })),
        },
        null,
        2,
      ),
    )
  } else {
    prettyPrint(results)
  }

  const anyFailure = results.some((r) => r.status !== 'pass')
  process.exit(anyFailure ? 1 : 0)
}

main().catch((err) => {
  console.error('doctor:arch runner error:', err)
  process.exit(2)
})
