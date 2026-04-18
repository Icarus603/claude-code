#!/usr/bin/env bun
/**
 * verify-event-spine.ts — L3 AST-lite check for V7 §9.10 event spine.
 *
 * V7 §9.10 mandates:
 *   - AgentEvent is a tagged union (discriminator field `kind` or `type`)
 *   - Every variant carries `turnId: string` and `ts: number`
 *   - Agent is the sole event producer; Output/observability/storage
 *     subscribe to the same stream
 *
 * The current packages/agent/types/events.ts has 10+ separate interfaces
 * (MessageEvent, ToolStartEvent, ...) with NO turnId or ts fields. Fork/
 * resume/replay depends on these; without them, §14.5 is unreachable.
 *
 * This verifier:
 *   1. Parses packages/agent/types/events.ts (or contracts.ts)
 *   2. Finds the AgentEvent / CoreEvent union type
 *   3. Checks every branch carries turnId + ts
 *
 * Implementation: regex-based (no ts-morph dependency). The AgentEvent
 * union shape is rigid enough that regex is sufficient; when V7 gets more
 * nuanced we can upgrade to a real TypeScript parser.
 */

import { readFile } from 'fs/promises'

const EVENTS_FILE_CANDIDATES = [
  'packages/agent/types/events.ts',
  'packages/agent/contracts/events.ts',
  'packages/agent/src/types/events.ts',
  'packages/agent/src/contracts/events.ts',
]

async function locateEventsFile(): Promise<string> {
  for (const p of EVENTS_FILE_CANDIDATES) {
    try {
      await readFile(p, 'utf8')
      return p
    } catch { /* try next */ }
  }
  throw new Error(`V7 §9.10: AgentEvent source file not found. Tried:\n  ${EVENTS_FILE_CANDIDATES.join('\n  ')}`)
}

/**
 * Extract every interface/type definition with a discriminant field
 * (literal string `type: 'foo'` or `kind: 'foo'`). Returns a map of
 * variant-name → raw body text.
 */
function extractVariants(source: string): Map<string, string> {
  const variants = new Map<string, string>()
  // interface Name { ... }
  const iface = /\binterface\s+(\w+)\s*\{([\s\S]*?)\n\}/g
  let m: RegExpExecArray | null
  while ((m = iface.exec(source)) !== null) {
    const [, name, body] = m
    // must have a discriminant
    if (/\b(type|kind)\s*:\s*['"][^'"]+['"]/.test(body!)) {
      variants.set(name!, body!)
    }
  }
  return variants
}

/**
 * Find the top-level union type export whose right-hand side enumerates
 * multiple variants. Returns { name, members: string[] } or null.
 */
function extractUnion(source: string): { name: string; members: string[] } | null {
  // Allow both `export type AgentEvent = A | B | C` and
  // `export type AgentEvent = | A | B`.
  const re = /export\s+type\s+(AgentEvent|CoreEvent|AgentEventUnion|AgentEventAny)\s*=\s*([\s\S]*?);/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    const [, name, rhs] = m
    const members = rhs!
      .replace(/^\s*\|\s*/g, '')
      .split('|')
      .map(s => s.trim())
      .filter(Boolean)
    if (members.length >= 2) {
      return { name: name!, members }
    }
  }
  return null
}

function variantCarriesField(body: string, field: string, expectedType: RegExp): boolean {
  // Look for `field: <type>` or `field?: <type>` at any indentation.
  const re = new RegExp(`\\b${field}\\??\\s*:\\s*([^\\n;,}]+)`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    if (expectedType.test(m[1]!)) return true
  }
  return false
}

async function main(): Promise<void> {
  const file = await locateEventsFile()
  const source = await readFile(file, 'utf8')

  const union = extractUnion(source)
  if (!union) {
    throw new Error(
      `V7 §9.10: no AgentEvent/CoreEvent union found in ${file}. ` +
      `Expected \`export type AgentEvent = A | B | ...\`.`,
    )
  }

  const variants = extractVariants(source)
  const problems: string[] = []

  for (const member of union.members) {
    const body = variants.get(member)
    if (!body) {
      // Member might be a literal union (e.g. `{ type: 'x' }`); extract inline
      const inline = member.match(/^\{([\s\S]*)\}$/)
      if (!inline) {
        problems.push(`  union member "${member}" has no resolvable body`)
        continue
      }
      const b = inline[1]!
      if (!variantCarriesField(b, 'turnId', /^string$/))
        problems.push(`  inline variant "${member}" missing turnId: string`)
      if (!variantCarriesField(b, 'ts', /^number$/))
        problems.push(`  inline variant "${member}" missing ts: number`)
      continue
    }

    if (!variantCarriesField(body, 'turnId', /^string$/)) {
      problems.push(`  variant "${member}" missing turnId: string field`)
    }
    if (!variantCarriesField(body, 'ts', /^number$/)) {
      problems.push(`  variant "${member}" missing ts: number field`)
    }
  }

  console.log(`event spine report (${file}):`)
  console.log(`  union: ${union.name}`)
  console.log(`  variants: ${union.members.length}`)
  console.log(`  variants with turnId+ts: ${union.members.length - new Set(problems.map(p => p.match(/"([^"]+)"/)?.[1]).filter(Boolean)).size}`)

  if (problems.length > 0) {
    console.error('\nV7 §9.10 violations:')
    for (const p of problems) console.error(p)
    throw new Error(
      `AgentEvent spine does not satisfy §9.10 (every variant must carry turnId + ts). ` +
      `This blocks fork/resume/replay per §14.5.`,
    )
  }

  console.log('\nevent spine verification passed')
}

await main()
