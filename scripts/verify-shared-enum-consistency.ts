#!/usr/bin/env bun
/**
 * verify-shared-enum-consistency — when the same conceptual enum is duplicated
 * in two source-of-truth locations (e.g., HOOK_EVENTS in headless-sdk +
 * config/settings/schemas/hooks.ts), assert they're byte-identical.
 *
 * Why: V7 §11.4 inlined HOOK_EVENTS into config/settings to avoid a Wave-1
 * cross-package dep. Both arrays are intentional duplicates today — but any
 * future divergence becomes a silent runtime mismatch (one path emits an
 * event the other path's schema rejects). Lock identity at CI time.
 *
 * Pattern: each entry = (name, [{file, regex_to_extract_array}]).
 * Verifier extracts each side, sorts, asserts equal.
 *
 * To add a new shared enum: append to SHARED_ENUMS and the verifier
 * mechanically catches drift on the next push.
 */
import { readFileSync } from 'fs'
import { join, resolve } from 'path'

const REPO_ROOT = resolve(import.meta.dirname, '..')

interface SharedEnumDef {
  name: string
  sources: Array<{
    file: string
    /** Match against `<NAME> = [<members>] as const`. Pattern must capture array body in group 1. */
    pattern: RegExp
  }>
}

const SHARED_ENUMS: SharedEnumDef[] = [
  {
    name: 'HOOK_EVENTS',
    sources: [
      {
        file: 'packages/headless-sdk/src/coreTypes.ts',
        pattern: /HOOK_EVENTS\s*=\s*\[([\s\S]*?)\]\s*as\s+const/,
      },
      {
        file: 'packages/config/settings/schemas/hooks.ts',
        pattern: /HOOK_EVENTS\s*=\s*\[([\s\S]*?)\]\s*as\s+const/,
      },
    ],
  },
]

function extractMembers(content: string, pattern: RegExp): string[] | null {
  const m = content.match(pattern)
  if (!m) return null
  return m[1]!
    .split(',')
    .map(s => s.trim().replace(/^['"]|['"]$/g, '').replace(/\/\/.*$/g, '').trim())
    .filter(Boolean)
}

const violations: string[] = []
let okCount = 0

for (const def of SHARED_ENUMS) {
  const memberSets: Array<{ file: string; members: string[] }> = []
  for (const src of def.sources) {
    let content: string
    try {
      content = readFileSync(join(REPO_ROOT, src.file), 'utf8')
    } catch {
      violations.push(`${def.name}: source file ${src.file} not readable`)
      continue
    }
    const members = extractMembers(content, src.pattern)
    if (!members) {
      violations.push(
        `${def.name}: pattern did not match in ${src.file} — array shape changed?`,
      )
      continue
    }
    memberSets.push({ file: src.file, members })
  }

  if (memberSets.length < 2) continue

  // All sets must be set-equal
  const ref = new Set(memberSets[0]!.members)
  for (let i = 1; i < memberSets.length; i++) {
    const cur = new Set(memberSets[i]!.members)
    const onlyInRef = [...ref].filter(x => !cur.has(x))
    const onlyInCur = [...cur].filter(x => !ref.has(x))
    if (onlyInRef.length || onlyInCur.length) {
      violations.push(
        `${def.name}: divergence between ${memberSets[0]!.file} and ${memberSets[i]!.file}\n` +
          (onlyInRef.length ? `    only in ${memberSets[0]!.file}: ${onlyInRef.join(', ')}\n` : '') +
          (onlyInCur.length ? `    only in ${memberSets[i]!.file}: ${onlyInCur.join(', ')}\n` : ''),
      )
    }
  }
  if (violations.length === 0) okCount++
}

if (violations.length > 0) {
  console.error(`verify-shared-enum-consistency: ${violations.length} divergence(s)`)
  console.error('')
  for (const v of violations) console.error(v)
  console.error(
    '\nFix: bring both source files into sync. The SHARED_ENUMS list in this verifier is intentional — any new enum that gets duplicated for boundary reasons should be added to that list.',
  )
  process.exit(1)
}

console.log(
  `verify-shared-enum-consistency: ${SHARED_ENUMS.length} shared enums all consistent`,
)
