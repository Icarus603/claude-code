#!/usr/bin/env bun
/**
 * Audit 01: unwired _deps.ts setter slots.
 *
 * For every `setXxxFn` exported from any packages/**\/_deps.ts:
 *   - count how many times it's CALLED anywhere in packages/**
 *   - flag those with 0 callers as silent-no-op slots
 *   - additionally classify by paired getter readability:
 *     * dead (no reader either) → LOW (delete-only)
 *     * read-only (reader exists, no writer) → CRITICAL (latent bug)
 *
 * This is the audit form of `scripts/verify-deps-setters-wired.ts` —
 * both share the same detection logic, but this one outputs structured
 * findings for the inventory.
 */
import { execSync } from 'child_process'
import { findFiles, readSafe, emitJson, summarize, type Finding, type AuditResult } from './lib.js'

interface Slot { name: string; file: string; line: number }

function listSlots(file: string): Slot[] {
  const text = readSafe(file)
  const lines = text.split('\n')
  const slots: Slot[] = []
  for (let i = 0; i < lines.length; i++) {
    let m: RegExpMatchArray | null = null
    if ((m = lines[i].match(/^export const (set\w+Fn)\s*=/))) {
      slots.push({ name: m[1], file, line: i + 1 })
    } else if ((m = lines[i].match(/^export function (set\w+Fn)\b/))) {
      slots.push({ name: m[1], file, line: i + 1 })
    }
  }
  return slots
}

function countCallers(name: string, ownFile: string): number {
  // Direct calls: `name(`.
  let raw = ''
  try {
    raw = execSync(
      `grep -rE '\\b${name}\\s*\\(' packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules`,
      { encoding: 'utf8' },
    )
  } catch {}
  const direct = raw.split('\n').filter(l => l && !l.startsWith(ownFile + ':')).length
  if (direct > 0) return direct

  // Dynamic alias: `const { setXxxFn: _alias } = require(...)` then `_alias(...)`.
  // Used in installPluginBindings.ts when conditionally wiring optional subsystems.
  // Mirrors the logic in scripts/verify-deps-setters-wired.ts.
  let aliasRaw = ''
  try {
    aliasRaw = execSync(
      `grep -rE '\\b${name}\\s*:\\s*\\w+' packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules`,
      { encoding: 'utf8' },
    )
  } catch {}
  return aliasRaw.split('\n').filter(l => l && !l.startsWith(ownFile + ':')).length
}

function pairedGetterName(setter: string): string | null {
  const m = setter.match(/^set(.+)Fn$/)
  if (!m) return null
  return m[1].charAt(0).toLowerCase() + m[1].slice(1)
}

function countReaders(getterName: string, ownFile: string): number {
  let raw = ''
  try {
    raw = execSync(
      `grep -rE '\\b${getterName}\\s*\\(' packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules`,
      { encoding: 'utf8' },
    )
  } catch {}
  return raw.split('\n').filter(l => l && !l.startsWith(ownFile + ':')).length
}

const depsFiles = findFiles('packages', '_deps.ts')
const findings: Finding[] = []
let totalSlots = 0

for (const f of depsFiles) {
  for (const slot of listSlots(f)) {
    totalSlots++
    const writeCount = countCallers(slot.name, f)
    if (writeCount > 0) continue  // wired, skip

    const getter = pairedGetterName(slot.name)
    const readCount = getter ? countReaders(getter, f) : 0

    if (readCount === 0) {
      findings.push({
        pattern: 'unwired-setter-slot',
        file: slot.file,
        line: slot.line,
        snippet: `export ... ${slot.name}`,
        severity: 'LOW',
        note: `Slot has no writer AND no reader. Pure dead code; delete the slot, the default state, the getter, and the setter export.`,
      })
    } else {
      findings.push({
        pattern: 'unwired-setter-slot',
        file: slot.file,
        line: slot.line,
        snippet: `export ... ${slot.name} (paired getter: ${getter}, ${readCount} readers)`,
        severity: 'CRITICAL',
        note: `Slot has ${readCount} reader(s) of ${getter}() but ZERO writers. Default impl will fire silently — exact ralph-loop bug class. Either (a) inline-import the real impl in the reader, or (b) wire it in app-host/runtime/install*Bindings.ts.`,
      })
    }
  }
}

const result: AuditResult = {
  pattern: 'unwired-setter-slot',
  description: '_deps.ts setter slots whose paired wire was never written',
  totalScanned: totalSlots,
  findings,
}

if (process.argv.includes('--summary')) {
  console.error(summarize(result))
} else {
  emitJson(result)
}
