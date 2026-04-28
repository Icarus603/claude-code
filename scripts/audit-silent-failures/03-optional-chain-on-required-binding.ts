#!/usr/bin/env bun
/**
 * Audit 03: optional chain (?.) on contract methods that are NOT optional.
 *
 * Pattern: `getXxxBindings().method?.()` where the contract type defines
 * `method: () => ...` (not `method?: () => ...`). The `?.` silently
 * degrades when the binding wasn't installed, hiding the wire mistake
 * rather than crashing — exactly the V7 silent-failure mode.
 *
 * Detection:
 *   1. Find all "contracts.ts" / "contracts/" files in packages/.
 *   2. Parse each interface's methods, classify as required vs optional
 *      (looking for `?:` in the field name).
 *   3. Find every callsite that does `.method?.(` and check if `method`
 *      is a known *required* contract field.
 *
 * Approximation: same-name methods across multiple contracts can collide.
 * Findings are HIGH severity — review needed before fix.
 */
import { findFiles, readSafe, emitJson, summarize, type Finding, type AuditResult } from './lib.js'
import { execSync } from 'child_process'

interface ContractField { name: string; required: boolean; file: string }

function listContractFiles(): string[] {
  const a = findFiles('packages', 'contracts.ts')
  const b = execSync(
    `find packages -path '*/contracts/*.ts' -not -path '*/node_modules/*' 2>/dev/null || true`,
    { encoding: 'utf8' },
  ).trim().split('\n').filter(Boolean)
  return [...a, ...b]
}

function parseContractFields(file: string): ContractField[] {
  const text = readSafe(file)
  const fields: ContractField[] = []
  // Match `name: type` or `name?: type` inside an interface block.
  // Limit to interface bodies to avoid catching object literals elsewhere.
  // Heuristic: pick lines like `  name?: (...) =>` or `  name: (...) =>` or
  // `  name?(...): ...`.
  for (const ln of text.split('\n')) {
    const m = ln.match(/^\s+(\w+)(\??):\s*\(/) ||
              ln.match(/^\s+(\w+)(\??)\s*\(/)
    if (!m) continue
    fields.push({ name: m[1], required: m[2] !== '?', file })
  }
  return fields
}

const contracts = listContractFiles()
const allFields: ContractField[] = []
for (const f of contracts) allFields.push(...parseContractFields(f))

// Build "is this name a required contract method anywhere?" lookup.
// If a method is required in one contract and optional in another, we still
// flag it (conservative): the caller may be hitting either.
const requiredNames = new Set<string>()
const everyOptional = new Map<string, boolean>()
for (const f of allFields) {
  if (f.required) requiredNames.add(f.name)
  if (!everyOptional.has(f.name)) everyOptional.set(f.name, true)
  if (f.required) everyOptional.set(f.name, false)
}

const findings: Finding[] = []

// 2. find `.method?.(` callsites
let raw = ''
try {
  raw = execSync(
    `grep -rEn '\\.\\w+\\?\\.\\(' packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules`,
    { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 },
  )
} catch {}

for (const ln of raw.split('\n')) {
  const m = ln.match(/^([^:]+):(\d+):(.*)$/)
  if (!m) continue
  const [_, file, lineStr, content] = m
  // Skip __tests__ and tests/
  if (file.includes('/__tests__/') || file.startsWith('tests/')) continue
  // Skip comments
  if (/^\s*(\/\/|\*|\/\*)/.test(content)) continue
  // Skip lodash memoize cache patterns: `someFn.cache.clear?.()` and
  // `someFn.cache?.clear?.()`. lodash memoize doesn't strictly guarantee
  // the cache shape; the `?.` is defensive, not a contract-binding bug.
  if (/\.cache\??\.\w+\?\.\(/.test(content)) continue
  // Skip when the result of `?.()` is consumed by `??` — the caller is
  // explicitly graceful-degrading and the optional chain is the contract.
  // Examples: `cmd.isEnabled?.() ?? true`, `auth?.refreshToken?.() ?? null`.
  if (/\?\.\([^)]*\)\s*(\?\?|\|\||&&)/.test(content)) continue
  // Skip optional-chain navigation through a nullable receiver:
  // `getX?.()?.method?.()` — the outer `getX?.()` is the binding access;
  // any subsequent `?.()` is navigating through a return value that is
  // genuinely optional.
  if (/\)\s*\?\.\w+\?\.\(/.test(content)) continue
  // Extract the method name from `.NAME?.(`
  const methods = [...content.matchAll(/\.(\w+)\?\.\(/g)].map(x => x[1])
  for (const method of methods) {
    if (!requiredNames.has(method)) continue
    // The same name might also appear in optional contracts — flag HIGH
    // (worth a manual look) rather than CRITICAL.
    const sometimesOptional = everyOptional.get(method) === false
      ? false
      : true  // appears optional in at least one contract → ambiguous
    findings.push({
      pattern: 'optional-chain-on-required-binding',
      file,
      line: parseInt(lineStr, 10),
      snippet: content.trim().slice(0, 120),
      severity: sometimesOptional ? 'MEDIUM' : 'HIGH',
      note: `\`?.()\` on \`${method}\` — at least one contract declares it as required (no \`?:\`). If this caller's binding source has \`${method}\` non-optional, the \`?.\` silently swallows "binding not installed" failures. Triage by tracing which contract this caller's binding implements.`,
    })
  }
}

const result: AuditResult = {
  pattern: 'optional-chain-on-required-binding',
  description: '?. on contract methods declared as required — masks unwired bindings',
  totalScanned: requiredNames.size,
  findings,
}

if (process.argv.includes('--summary')) {
  console.error(summarize(result))
} else {
  emitJson(result)
}
