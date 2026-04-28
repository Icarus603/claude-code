#!/usr/bin/env bun
/**
 * verify-deps-setters-wired — every `setXxxFn` exported from a `_deps.ts`
 * must have at least one caller in packages/ outside its own file.
 *
 * Background: V7 packages (config/plugin, shell, output, local-observability,
 * config/env) decouple from app-host using a setter-injection pattern. Each
 * external dep is declared as a slot:
 *
 *   const [_get, setXxxFn_] = makeSetter(safeDefault)
 *   export const setXxxFn = setXxxFn_
 *
 * The host bootstrap (typically packages/app-host/src/runtime/install*Bindings.ts)
 * is supposed to call `setXxxFn(realImpl)` at startup so the slot resolves to
 * the real implementation.
 *
 * When a slot is declared but never wired by anyone, the default fires
 * silently. Sometimes that's harmless (returns []); sometimes it returns
 * null and crashes the next caller. The plugin Stop hook bug
 * (commit 8858c83d) was four such unwired slots — silently no-op'd
 * since V7 day one.
 *
 * This verifier is binary: every exported setter must have ≥1 caller.
 * No baseline ratchet — wiring is structural; either it's connected or
 * the slot is dead code.
 *
 * Allowlist: a slot may declare itself unwired-by-design via a comment
 *   `// verify-deps-setters-wired: allow-unwired (reason)`
 * on the line above its export. Use sparingly — most "dead" slots should
 * be deleted, not allowlisted.
 */

import { readFileSync } from 'fs'
import { execSync } from 'child_process'

interface Slot {
  name: string
  file: string
  line: number
  allowed: boolean
}

function findDepsFiles(): string[] {
  const out = execSync(
    `find packages -name _deps.ts -not -path '*/node_modules/*'`,
    { encoding: 'utf8' },
  ).trim()
  return out ? out.split('\n').filter(Boolean) : []
}

function extractSlots(file: string): Slot[] {
  const text = readFileSync(file, 'utf8')
  const lines = text.split('\n')
  const slots: Slot[] = []
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    let m: RegExpMatchArray | null = null
    if ((m = ln.match(/^export const (set\w+Fn)\s*=/))) {
      // ok
    } else if ((m = ln.match(/^export function (set\w+Fn)\b/))) {
      // ok
    } else continue
    const allowed =
      i > 0 &&
      /verify-deps-setters-wired:\s*allow-unwired/.test(lines[i - 1])
    slots.push({ name: m[1], file, line: i + 1, allowed })
  }
  return slots
}

function countCallers(slot: Slot): number {
  // grep packages/ for `slotName(` — must be a call, not a re-export.
  // Exclude the slot's own _deps.ts file.
  // This is the same heuristic used in the audit that surfaced the bug.
  let raw = ''
  try {
    raw = execSync(
      `grep -rE '\\b${slot.name}\\s*\\(' packages --include='*.ts' --include='*.tsx' --exclude-dir=node_modules`,
      { encoding: 'utf8' },
    )
  } catch {
    return 0
  }
  const lines = raw.split('\n').filter(l => l && !l.startsWith(slot.file + ':'))
  return lines.length
}

async function main(): Promise<void> {
  const depsFiles = findDepsFiles()
  if (depsFiles.length === 0) {
    console.log('verify-deps-setters-wired: no _deps.ts files found')
    return
  }

  const allSlots: Slot[] = []
  for (const f of depsFiles) {
    allSlots.push(...extractSlots(f))
  }

  const violations: Array<Slot & { reason: string }> = []
  for (const s of allSlots) {
    if (s.allowed) continue
    const callers = countCallers(s)
    if (callers === 0) {
      violations.push({
        ...s,
        reason: `${s.file}:${s.line} setter "${s.name}" is exported but never called. The default value will fire silently; either wire it in install*Bindings.ts or delete the slot. Mark with "// verify-deps-setters-wired: allow-unwired (reason)" if intentional.`,
      })
    }
  }

  if (violations.length > 0) {
    console.error('verify-deps-setters-wired: unwired setter slots:')
    for (const v of violations.slice(0, 60)) {
      console.error(`  - ${v.reason}`)
    }
    if (violations.length > 60) {
      console.error(`  ...${violations.length - 60} more`)
    }
    throw new Error(
      `${violations.length} setter slot(s) declared but never wired (${allSlots.length} total slots).`,
    )
  }
  console.log(
    `verify-deps-setters-wired: ${allSlots.length} setter slots, all wired (or allowed)`,
  )
}

await main()
