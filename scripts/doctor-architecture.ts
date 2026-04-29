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
    id: 'command-runtime',
    layer: 'Platform Runtime',
    subsystem: 'command-runtime',
    script: 'scripts/verify-command-runtime.ts',
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
  {
    id: 'package-tsc-clean',
    layer: 'Cross-Cutting',
    subsystem: 'tsc noise boundary',
    script: 'scripts/verify-package-tsc-clean.ts',
    doc: 'V7 §19.2',
  },
  {
    id: 'testing-seams',
    layer: 'Cross-Cutting',
    subsystem: 'testing seams policy',
    script: 'scripts/verify-testing-seams.ts',
    doc: 'V7 §9.11',
  },
  {
    id: 'error-namespaces',
    layer: 'Cross-Cutting',
    subsystem: 'typed error taxonomy',
    script: 'scripts/verify-error-namespaces.ts',
    doc: 'V7 §6.5 / §3.8',
  },
  {
    id: 'ownership-gravity',
    layer: 'Cross-Cutting',
    subsystem: 'owner-over-shim',
    script: 'scripts/verify-ownership-gravity.ts',
    doc: 'V7 §3.1 / §10 / §14.1',
  },
  {
    id: 'import-graph',
    layer: 'Cross-Cutting',
    subsystem: 'dependency rules',
    script: 'scripts/verify-import-graph.ts',
    doc: 'V7 §11.2 (ast-level replacement for runtime-boundaries string match)',
  },
  {
    id: 'reverse-shims',
    layer: 'Cross-Cutting',
    subsystem: 'owner-over-shim',
    script: 'scripts/verify-reverse-shims.ts',
    doc: 'V7 §3.1 — packages re-exporting FROM src is not ownership',
  },
  {
    id: 'replview-shrinks',
    layer: 'App Hosts',
    subsystem: 'repl',
    script: 'scripts/verify-replview-shrinks.ts',
    doc: 'V7 §3.3 — REPLView.tsx LOC must decrease monotonically',
  },
  {
    id: 'no-holding-pens',
    layer: 'Cross-Cutting',
    subsystem: 'naming hygiene',
    script: 'scripts/verify-no-holding-pens.ts',
    doc: 'V7 §3.1 — packages/* must not have transient holding-pen dir names',
  },
  {
    id: 'src-shrinks',
    layer: 'Cross-Cutting',
    subsystem: 'src evacuation',
    script: 'scripts/verify-src-shrinks.ts',
    doc: 'V7 §3.1 — non-entrypoint src/ LOC must monotonically decrease toward 0',
  },
  {
    id: 'build-resolves',
    layer: 'Cross-Cutting',
    subsystem: 'import graph integrity',
    script: 'scripts/verify-build-resolves.ts',
    doc: 'V7 §11.2 — bundler resolves all imports (catches stale @claude-code/X paths)',
  },
  {
    id: 'feature-canonical',
    layer: 'Cross-Cutting',
    subsystem: 'feature flag boundary',
    script: 'scripts/verify-feature-canonical.ts',
    doc: 'CLAUDE.md §Feature Flag System — feature() must come from bun:bundle',
  },
  {
    id: 'no-deprecated-suffix-without-canonical',
    layer: 'Cross-Cutting',
    subsystem: 'deprecation hygiene',
    script: 'scripts/verify-no-deprecated-suffix-without-canonical.ts',
    doc: 'docs/refactor/deprecated-suffix-audit.md — every _DEPRECATED-suffixed export must have a non-suffixed canonical sibling. Locks zero-baseline at 0 (post-2026-04-29 rename).',
  },
  {
    id: 'deps-quality',
    layer: 'Cross-Cutting',
    subsystem: '_deps.ts ratchet',
    script: 'scripts/verify-deps-quality.ts',
    doc: 'V7 §3.2 — lazy-require count + unknown-typed setter slot count in config/plugin/_deps.ts. Both are monotonic-shrink ratchets. Tighten with --tighten after a real reduction.',
  },
  {
    id: 'knip-headroom',
    layer: 'Cross-Cutting',
    subsystem: 'dead-code ratchet',
    script: 'scripts/verify-knip-headroom.ts',
    doc: 'docs/refactor/knip-unused-classification.md — knip unused-file (packages/-scoped) and unused-export counts. Both monotonic-shrink. Tighten with --tighten after deleting dead shims.',
  },
  {
    id: 'no-bare-host-loggers',
    layer: 'Cross-Cutting',
    subsystem: 'host-binding migration completeness',
    script: 'scripts/verify-no-bare-host-loggers.ts',
    doc: 'host-binding loggers (logEvent, logError, logDebug, logForDebugging, logAntError) must not be called bare without import or local declaration — bare calls throw ReferenceError that gets swallowed in catch handlers (see fileHistoryCore.ts:786 incident, fixed in 94d6c10d)',
  },
  {
    id: 'no-cycles',
    layer: 'Cross-Cutting',
    subsystem: 'import graph cycles',
    script: 'scripts/verify-no-cycles.ts',
    doc: 'V7 §11.2 — cyclic import chains in packages/ may shrink but not grow',
  },
  {
    id: 'tsc-errors',
    layer: 'Cross-Cutting',
    subsystem: 'type safety ratchet',
    script: 'scripts/verify-tsc-errors.ts',
    doc: 'V7 §19.2 — tsc error count may shrink but not grow',
  },
  {
    id: 'facade-budget',
    layer: 'Cross-Cutting',
    subsystem: 'src/ facade ratchet',
    script: 'scripts/verify-facade-budget.ts',
    doc: 'V7 §10.3 — init-side-effect facades in src/ may shrink but not grow',
  },
  {
    id: 'cross-package-coupling',
    layer: 'Cross-Cutting',
    subsystem: 'coupling',
    script: 'scripts/verify-cross-package-coupling.ts',
    doc: 'V7 §3.2 / §8 — distinct cross-package deps per package may not grow',
  },
  {
    id: 'deps-arity',
    layer: 'Cross-Cutting',
    subsystem: 'forwarder arity safety',
    script: 'scripts/verify-deps-arity.ts',
    doc: 'V7 §3.2 — _deps.ts public exports must forward all params to setter (catches arg-drop bugs)',
  },
  {
    id: 'schema-validation-mismatch',
    layer: 'Cross-Cutting',
    subsystem: 'tool contract safety',
    script: 'scripts/verify-schema-validation-mismatch.ts',
    doc: 'Tool fields marked .optional() in schema must not be rejected as required by validateInput',
  },
  {
    id: 'deps-setter-audit',
    layer: 'Cross-Cutting',
    subsystem: 'setter shim safety',
    script: 'scripts/verify-deps-setter-audit.ts',
    doc: 'V7 §3.2 — packages/<X>/_deps.ts setters with dangerous defaults must be wired at boot',
  },
  {
    id: 'src-classifier',
    layer: 'Cross-Cutting',
    subsystem: 'src/ classification',
    script: 'scripts/verify-src-classifier.ts',
    doc: 'V7 §3.2 — per-class budgets on src/ (entrypoint, facade, shim, test, generated, other)',
  },
  {
    id: 'package-readme',
    layer: 'Cross-Cutting',
    subsystem: 'documentation',
    script: 'scripts/verify-package-readme.ts',
    doc: 'V7 §3.2 — every package describes its responsibility in README.md',
  },
  {
    id: 'package-private-src',
    layer: 'Cross-Cutting',
    subsystem: 'encapsulation',
    script: 'scripts/verify-package-private-src.ts',
    doc: 'V7 §3.2 — packages/<A> must not import @claude-code/<B>/src/... (src/ is private)',
  },
  {
    id: 'package-exports',
    layer: 'Cross-Cutting',
    subsystem: 'export map coverage',
    script: 'scripts/verify-package-exports.ts',
    doc: 'V7 §11.2 — cross-package imports must resolve through package.json exports',
  },
  {
    id: 'exports-budget',
    layer: 'Cross-Cutting',
    subsystem: 'export surface ratchet',
    script: 'scripts/verify-exports-budget.ts',
    doc: 'package.json#exports must monotonically shrink — dead entries cannot creep back',
  },
  {
    id: 'file-size',
    layer: 'Cross-Cutting',
    subsystem: 'file LOC ratchet',
    script: 'scripts/verify-file-size.ts',
    doc: 'New files ≤ 800 LOC; grandfathered large files may only shrink',
  },
  {
    id: 'deps-setters-wired',
    layer: 'Cross-Cutting',
    subsystem: 'silent-failure prevention',
    script: 'scripts/verify-deps-setters-wired.ts',
    doc: 'Every _deps.ts setter slot must have a caller (or allow-unwired comment)',
  },
  {
    id: 'await-generator-misuse',
    layer: 'Cross-Cutting',
    subsystem: 'silent-failure prevention',
    script: 'scripts/verify-await-generator-misuse.ts',
    doc: '`await asyncFunctionStar()` is forbidden — body never runs; use `for await` / `.next()` (HookDepImpl.onStop bug class)',
  },
  {
    id: 'dual-storage-divergence',
    layer: 'Cross-Cutting',
    subsystem: 'silent-failure prevention',
    script: 'scripts/verify-dual-storage-divergence.ts',
    doc: 'reader & writer of same logical store must share a backing — ralph-loop bug class (write to A, read from B)',
  },
  {
    id: 'optional-chain-on-required',
    layer: 'Cross-Cutting',
    subsystem: 'silent-failure prevention',
    script: 'scripts/verify-optional-chain-on-required.ts',
    doc: '`?.()` on a contract method declared as required masks unwired bindings',
  },
  {
    id: 'optional-method-no-guard',
    layer: 'Cross-Cutting',
    subsystem: 'silent-failure prevention',
    script: 'scripts/verify-optional-method-no-guard.ts',
    doc: 'values from `?.()` may not be dereferenced without `?? default` or null-check',
  },
  {
    id: 'module-level-null-state',
    layer: 'Cross-Cutting',
    subsystem: 'silent-failure prevention',
    script: 'scripts/verify-module-level-null-state.ts',
    doc: '`let X: T | null = null` at module level must have an in-file writer',
  },
  {
    id: 'silent-failure-ratchet',
    layer: 'Cross-Cutting',
    subsystem: 'silent-failure ratchet',
    script: 'scripts/verify-silent-failure-ratchet.ts',
    doc: '6 audit-pattern counts that cannot realistically be 0 today are baseline-locked; counts may shrink, never grow',
  },
  {
    id: 'host-binding-completeness',
    layer: 'Cross-Cutting',
    subsystem: 'silent-failure prevention',
    script: 'scripts/verify-host-binding-completeness.ts',
    doc: 'Every required field on a `XxxHostBindings` contract must have a wire in install*Bindings.ts / packageHostSetup.ts / runtimeHostSetup.ts / *Runtime.ts',
  },
  {
    id: 'duplicate-canonicals',
    layer: 'Cross-Cutting',
    subsystem: 'fork detection',
    script: 'scripts/verify-duplicate-canonicals.ts',
    doc: 'V7 §3.1 — same-name impl in src and packages is a silent fork',
  },
  {
    id: 'require-src-imports',
    layer: 'Cross-Cutting',
    subsystem: 'dependency rules',
    script: 'scripts/verify-require-src-imports.ts',
    doc: 'V7 §3.1 / §11.2 — runtime require(src/...) bypasses static analysis',
  },
  {
    id: 'anti-patterns',
    layer: 'Cross-Cutting',
    subsystem: 'anti-pattern scanner',
    script: 'scripts/verify-anti-patterns.ts',
    doc: 'V7 §3.8 / §7.2',
  },
  {
    id: 'ratchet',
    layer: 'Cross-Cutting',
    subsystem: 'regression ratchet',
    script: 'scripts/verify-ratchet.ts',
    doc: 'V7 §14 (one-way migration monotonicity)',
  },
  {
    id: 'exemptions',
    layer: 'Cross-Cutting',
    subsystem: 'V7-EXEMPT enforcement',
    script: 'scripts/verify-exemptions.ts',
    doc: 'V7 §13.2',
  },
  {
    id: 'non-negotiable-coverage',
    layer: 'Cross-Cutting',
    subsystem: 'verifier coverage',
    script: 'scripts/verify-non-negotiable-coverage.ts',
    doc: 'V7 §12 / §14.4',
  },
  {
    id: 'event-spine',
    layer: 'Core Domain',
    subsystem: 'agent',
    script: 'scripts/verify-event-spine.ts',
    doc: 'V7 §9.10 (AgentEvent must carry turnId + ts)',
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

  // Run checks concurrently with a small worker pool. Each check is an
  // independent subprocess; a pool of 8 keeps wall time low without
  // thrashing CPU/file-cache (M-series hits ~3s vs ~22s sequential).
  const POOL_SIZE = args.verbose ? 1 : 8
  const results: CheckResult[] = new Array(selected.length)
  let nextIdx = 0
  await Promise.all(
    Array.from({ length: Math.min(POOL_SIZE, selected.length) }, async () => {
      while (true) {
        const idx = nextIdx++
        if (idx >= selected.length) return
        results[idx] = await runCheck(selected[idx]!, args.verbose)
      }
    }),
  )

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
