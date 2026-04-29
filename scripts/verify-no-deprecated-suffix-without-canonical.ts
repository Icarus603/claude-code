#!/usr/bin/env bun
/**
 * verify-no-deprecated-suffix-without-canonical — `_DEPRECATED`-suffixed
 * exports must have a non-suffixed canonical sibling somewhere in
 * `packages/`. The suffix advertises "use the canonical instead", so a
 * canonical MUST exist or the suffix is misleading.
 *
 * This rule was added 2026-04-29 after audit found 12 _DEPRECATED symbols
 * in packages/, ALL of which had no canonical replacement — the suffix
 * was a misleading vestige of intent-to-replace that was never acted on.
 * After the rename pass, the codebase has 0 such symbols. This verifier
 * locks that at 0: any new `_DEPRECATED` suffix must be paired with the
 * canonical it intends to deprecate.
 *
 * Allow-list: the string literal 'commands_DEPRECATED' (in agent/command.ts
 * and friends) is user-facing data identifying plugin source — keeping it
 * is required for user data compatibility. We exempt string literals via
 * the regex below (only `\\b<name>_DEPRECATED\\b` in identifier position
 * is matched, not inside `'...'` quotes).
 */
import { Glob } from 'bun'
import { readFile } from 'fs/promises'

interface Finding {
  file: string
  line: number
  symbol: string
  reason: string
}

const findings: Finding[] = []

// First pass: collect every `_DEPRECATED`-suffixed identifier in an export
// position (function/class/const). These are the "candidate misnamed
// canonicals".
const deprecatedExports = new Map<string, { file: string; line: number }>()

// Second pass: collect every non-suffixed identifier in an export position.
// We use this to verify each `*_DEPRECATED` has a canonical sibling.
const canonicalExports = new Set<string>()

const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|class|const|let|interface|type|enum)\s+([A-Za-z_$][\w$]*)/
// Note: matches `export function X`, `export async function X`, `export const X`,
// `export class X`, etc. Anchored at start-of-line so it cannot match inside
// a string literal (which would be inside source code, not at column 0).

for await (const file of new Glob('packages/**/*.{ts,tsx}').scan('.')) {
  if (file.includes('node_modules/')) continue
  if (file.endsWith('.d.ts')) continue
  if (file.includes('__tests__/')) continue
  if (file.includes('/_archive/')) continue

  const content = await readFile(file, 'utf8')
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = line.match(EXPORT_RE)
    if (!m) continue
    const name = m[1]
    if (name.endsWith('_DEPRECATED')) {
      const canonical = name.slice(0, -'_DEPRECATED'.length)
      deprecatedExports.set(name, { file, line: i + 1 })
      // Defer canonical-existence check until we've scanned all files.
      void canonical
    } else {
      canonicalExports.add(name)
    }
  }
}

// Now verify each _DEPRECATED has a canonical sibling.
for (const [name, where] of deprecatedExports) {
  const canonical = name.slice(0, -'_DEPRECATED'.length)
  if (!canonicalExports.has(canonical)) {
    findings.push({
      file: where.file,
      line: where.line,
      symbol: name,
      reason: `no canonical sibling \`${canonical}\` exported anywhere in packages/. The _DEPRECATED suffix advertises a replacement that doesn't exist — either rename to drop the suffix, or write the real canonical.`,
    })
  }
}

if (findings.length > 0) {
  console.error(
    `✗ no-deprecated-suffix-without-canonical: ${findings.length} violation(s):`,
  )
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line} — ${f.symbol}`)
    console.error(`    ${f.reason}`)
  }
  console.error(
    `\nFix: rename the symbol to drop the _DEPRECATED suffix (it IS the canonical), OR add the real canonical replacement and migrate callers.`,
  )
  console.error(
    `See docs/refactor/deprecated-suffix-audit.md for context.`,
  )
  process.exit(1)
}

console.log(
  `verify-no-deprecated-suffix-without-canonical: ${deprecatedExports.size} _DEPRECATED export(s), ${
    deprecatedExports.size === 0 ? 'zero baseline locked' : 'all paired with canonical'
  }`,
)
