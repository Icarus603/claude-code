/**
 * verify-package-tsc-clean.ts — V7 §19.2 (TypeScript noise boundary)
 *
 * Runs `tsc --noEmit` on the project and fails if any file under the listed
 * packages reports `Cannot find name '...'` or `has no exported member '...'`.
 *
 * Motivation: commit 903c46b extracted ~4090 lines of the run() .action()
 * body from src/main.tsx into packages/cli/src/entry/mode-dispatch.ts but
 * left five identifier bindings behind. At runtime each resolved to
 * undefined and threw a TypeError that Ink's patchConsole silently swallowed,
 * blanking the REPL. tsc catches the exact class of bug in one pass — V7
 * §14.1 already forbids package-internal tsc noise, so wire a verifier for
 * this specific signature to block regressions at the doctor:arch gate.
 *
 * V7 §19.2 allows transition-period tsc noise in legacy files (decompiled
 * output full of unknown/never/{}), so this check is targeted: it only fails
 * on missing-reference errors in files that have been formally moved into
 * the owner packages. Broad `--strict` failures are out of scope here.
 */

import { spawn } from 'node:child_process'

const WATCHED_PATH_PREFIXES = [
  'packages/cli/src/entry/',
  'packages/cli/src/commands/',
  'packages/cli/src/headless/',
  'packages/agent/src/',
  'packages/provider/src/',
  'packages/permission/src/',
  'packages/memory/src/',
  'packages/config/src/',
  'packages/tool-registry/src/',
  'packages/command-registry/src/',
  'packages/mcp-runtime/src/',
  'packages/app-host/src/',
  'packages/storage/src/',
  'packages/output/src/',
  'packages/local-observability/src/',
] as const

// Error codes that indicate a symbol was referenced without being imported /
// exported. Anything else (type mismatches, missing generic args, etc.) is
// out of scope for this verifier — §19.2 explicitly accepts tsc noise for
// decompiled code, so we only want to catch the regression pattern that
// crashes the REPL at runtime.
const MISSING_REFERENCE_CODES = new Set([
  'TS2304', // Cannot find name 'X'
  'TS2305', // Module 'X' has no exported member 'Y'
  'TS2307', // Cannot find module 'X' or its corresponding type declarations
  'TS2552', // Cannot find name 'X'. Did you mean 'Y'?
])

type Violation = {
  file: string
  line: number
  col: number
  code: string
  message: string
}

async function runTsc(): Promise<string> {
  return await new Promise((resolve, reject) => {
    const proc = spawn(
      'bun',
      ['x', 'tsc', '--noEmit', '-p', 'tsconfig.json'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    proc.stdout.on('data', chunk => {
      stdout += String(chunk)
    })
    proc.stderr.on('data', chunk => {
      stdout += String(chunk)
    })
    proc.on('error', reject)
    proc.on('close', () => {
      // tsc always exits non-zero when there are errors; we parse stdout
      // regardless of exit code.
      resolve(stdout)
    })
  })
}

function parseTscOutput(output: string): Violation[] {
  const violations: Violation[] = []
  // tsc format: `path/to/file.ts(LINE,COL): error TSxxxx: message`
  const re = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/
  for (const raw of output.split(/\r?\n/)) {
    const match = re.exec(raw)
    if (!match) continue
    const [, file, line, col, code, message] = match as unknown as [
      string,
      string,
      string,
      string,
      string,
      string,
    ]
    if (!MISSING_REFERENCE_CODES.has(code)) continue
    if (!WATCHED_PATH_PREFIXES.some(prefix => file.startsWith(prefix))) {
      continue
    }
    violations.push({
      file,
      line: Number(line),
      col: Number(col),
      code,
      message,
    })
  }
  return violations
}

async function main(): Promise<void> {
  const output = await runTsc()
  const violations = parseTscOutput(output)

  if (violations.length > 0) {
    const grouped: Record<string, Violation[]> = {}
    for (const v of violations) {
      ;(grouped[v.file] ??= []).push(v)
    }
    const lines = Object.entries(grouped).flatMap(([file, vs]) => [
      `${file}:`,
      ...vs.map(v => `  ${v.line}:${v.col}  ${v.code}  ${v.message}`),
    ])
    throw new Error(
      `${violations.length} missing-reference error(s) in formal packages — ` +
        `each one is a runtime crash waiting to happen (see commit 903c46b / ` +
        `REPL hang post-mortem):\n${lines.join('\n')}`,
    )
  }

  console.log('package tsc clean verification passed')
}

await main()
