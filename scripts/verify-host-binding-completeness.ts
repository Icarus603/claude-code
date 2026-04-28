#!/usr/bin/env bun
/**
 * verify-host-binding-completeness — every required field on a host
 * binding contract must have a corresponding wire in app-host's
 * install*Bindings.ts.
 *
 * Background: each subsystem package exports a `XxxHostBindings` type
 * (in contracts.ts) describing what the host must provide. The host
 * implementation lives in `packages/app-host/src/runtime/install*Bindings.ts`
 * (or `packages/app-host/src/packageHostSetup.ts` for the core bundle).
 *
 * The ralph-loop bug class showed up when a contract field was OPTIONAL
 * (`method?: ...`) and the host bootstrap simply forgot to wire it.
 * Optional means "binding may or may not exist" — but the consumer
 * (e.g. handleStopHooks) called `bindings.method?.()` and got undefined
 * forever. That class is now caught by verify-deps-setters-wired AND by
 * verify-optional-chain-on-required.
 *
 * This verifier catches the next-gen variant: REQUIRED contract field
 * added but never wired. Today this surfaces as a runtime crash on
 * first call (good — loud failure), but only if that code path is ever
 * exercised. Static verification here closes the gap before runtime.
 *
 * What the verifier does:
 *   1. Find every `XxxHostBindings` type in packages.
 *   2. Parse fields, classify required vs optional (`?:`).
 *   3. Find all install* / packageHostSetup body in app-host.
 *   4. For each contract: required fields - fields actually wired.
 *      Fail if non-empty.
 *
 * Allowlist exemption per contract:
 *   `// verify-host-binding-completeness: allow-incomplete (reason)`
 * anywhere in the contract file.
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..')

interface Contract {
  name: string
  file: string
  requiredFields: string[]
  optionalFields: string[]
  allowed: boolean
}

function findContractFiles(): string[] {
  let raw = ''
  try {
    raw = execSync(
      `grep -rEln 'export\\s+type\\s+\\w+HostBindings\\b' packages --include='*.ts' --exclude-dir=node_modules`,
      { encoding: 'utf8' },
    )
  } catch {}
  return raw.trim().split('\n').filter(Boolean)
}

function parseContracts(file: string): Contract[] {
  const text = readFileSync(file, 'utf8')
  const contracts: Contract[] = []
  // Strip block comments (handle nested /** ... */ style jsdoc).
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '')
  const lines = stripped.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^export\s+type\s+(\w+HostBindings)(?:<[^>]*>)?\s*=\s*\{/)
    if (!m) continue
    const name = m[1]
    // Brace-balance + paren-balance + bracket-balance from this line to
    // find the matching closing `}`. Top-level fields appear only when
    // brace-depth=1 AND paren-depth=0 AND bracket-depth=0 (otherwise we
    // are inside a nested signature like `f?: (a: T, b: T) => void`).
    let bDepth = 0
    let pDepth = 0
    let aDepth = 0
    let started = false
    let endLine = -1
    let templateDepth = 0  // backticks
    const required: string[] = []
    const optional: string[] = []
    for (let j = i; j < lines.length; j++) {
      const text = lines[j]
      let pos = 0
      while (pos < text.length) {
        const ch = text[pos]
        if (ch === '/' && text[pos + 1] === '/') break
        if (ch === '`') { templateDepth = templateDepth === 0 ? 1 : 0; pos++; continue }
        if (templateDepth > 0) { pos++; continue }
        if (ch === '{') { bDepth++; started = true; pos++; continue }
        if (ch === '}') { bDepth--; pos++; if (started && bDepth === 0) { endLine = j; break }; continue }
        if (ch === '(') { pDepth++; pos++; continue }
        if (ch === ')') { pDepth--; pos++; continue }
        if (ch === '[') { aDepth++; pos++; continue }
        if (ch === ']') { aDepth--; pos++; continue }
        // Top-level field: brace=1 AND no nesting via paren / bracket.
        if (started && bDepth === 1 && pDepth === 0 && aDepth === 0) {
          // Field name must start at the line's first non-whitespace.
          if (pos === text.search(/\S/)) {
            const remainder = text.slice(pos)
            const fm = remainder.match(/^(\w+)(\??)\s*[:(]/)
            if (fm) {
              if (fm[2] === '?') optional.push(fm[1])
              else required.push(fm[1])
              // Skip past the matched name (don't break — let the rest
              // of the line update brace/paren state so multi-line
              // signatures track correctly).
              pos += fm[0].length
              continue
            }
          }
        }
        pos++
      }
      if (endLine !== -1) break
    }

    const allowed = /verify-host-binding-completeness:\s*allow-incomplete/.test(text)
    contracts.push({ name, file, requiredFields: required, optionalFields: optional, allowed })
  }
  return contracts
}

function findInstallCalls(): string {
  // Scan both app-host's install*Bindings.ts AND each subsystem's
  // runtimeHostSetup.ts / host.ts. Bridge for example installs its own
  // bindings via packages/bridge/src/runtimeHostSetup.ts; tool-registry
  // does it via packages/tool-registry/src/toolRuntimeInstaller.ts.
  let files: string[] = []
  try {
    files = execSync(
      `find packages -type f ` +
        `\\( -name 'install*.ts' -o -name 'packageHostSetup.ts' ` +
        `-o -name 'runtimeHostSetup.ts' -o -name 'toolRuntimeInstaller.ts' ` +
        `-o -name 'providerHostSetup.ts' -o -name '*Runtime.ts' \\) ` +
        `-not -path '*/node_modules/*' -not -path '*/__tests__/*'`,
      { encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean)
  } catch {}
  return files.map(f => readFileSync(f, 'utf8')).join('\n\n')
}

async function main(): Promise<void> {
  const contractFiles = findContractFiles()
  const contracts: Contract[] = []
  for (const f of contractFiles) {
    contracts.push(...parseContracts(f))
  }

  const installBlob = findInstallCalls()

  const violations: string[] = []
  for (const c of contracts) {
    if (c.allowed) continue
    const missing: string[] = []
    for (const field of c.requiredFields) {
      // Match any of:
      //   - object literal property: `field: ...` or `field,` (shorthand)
      //     or `field` at end-of-line (also shorthand) inside an install call
      //   - setter call: `setFieldFn(...)`
      //   - direct assignment: `field = ...`
      // The shorthand check is loose — any line that has the word at top
      // level inside an install* file. False positives are bounded: the
      // install files are short and field names are distinctive.
      const cap = field[0].toUpperCase() + field.slice(1)
      const re = new RegExp(
        `\\b${field}\\s*[:,]` +
          `|\\bset${cap}Fn\\s*\\(` +
          `|\\b${field}\\s*=` +
          // shorthand at line end (with optional comma): /^\s*field,?\s*$/
          `|^\\s*${field},?\\s*$`,
        'm',
      )
      if (!re.test(installBlob)) missing.push(field)
    }
    if (missing.length > 0) {
      violations.push(
        `${c.name} (${c.file}): missing wires for ${missing.length} required field(s): ${missing.join(', ')}`,
      )
    }
  }

  if (violations.length > 0) {
    console.error('verify-host-binding-completeness: violations')
    for (const v of violations) console.error(`  - ${v}`)
    throw new Error(
      `${violations.length} host-binding contract(s) have unwired required fields. ` +
        `Either wire the field in install*Bindings.ts, or mark the field optional in the contract.`,
    )
  }
  console.log(
    `verify-host-binding-completeness: ${contracts.length} contracts, all required fields wired`,
  )
}

await main()
