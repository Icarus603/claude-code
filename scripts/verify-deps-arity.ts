#!/usr/bin/env bun
/**
 * verify-deps-arity — every public export in packages/<X>/_deps.ts that
 * forwards to a setter-resolved canonical impl must forward ALL its
 * positional args. Catches the bug class fixed in 4f4f6a12 where
 *   export function executeShellCommandsInPrompt(prompt: string) {
 *     return _getExecuteShellCommandsInPrompt()(prompt)
 *   }
 * dropped 3 caller-supplied args (context, slashCommandName, shell),
 * crashing every plugin slash command with a !cmd block.
 *
 * Heuristic: scan _deps.ts files, find each exported function whose
 * body is `return _getXxx()(arg1)` (single-arg call), and check
 * whether the function declared more than one parameter. A mismatch
 * (decl arity > forward arity) is a likely arg-drop bug.
 *
 * False positives: functions that intentionally pass only some args
 * (rare). Document with a `// arg-drop-intentional:` comment to
 * silence the rule.
 */

import { Glob } from 'bun'
import { readFile } from 'fs/promises'

const violations: { file: string; line: number; name: string; reason: string }[] =
  []

for await (const file of new Glob('packages/**/_deps.ts').scan('.')) {
  if (file.includes('node_modules/')) continue
  const lines = (await readFile(file, 'utf8')).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    // Match single-line forwarder pattern:
    //   export function NAME(p1: T, p2: U): R { return _getX()(p1) }
    const m = line.match(
      /^export\s+function\s+(\w+)\s*\(([^)]*)\)[^{]*\{\s*return\s+_get\w+\(\)\(([^)]*)\)\s*\}/,
    )
    if (!m) continue
    const [, name, paramStr, fwdStr] = m
    if (
      lines[i - 1]?.includes('arg-drop-intentional') ||
      lines[i - 2]?.includes('arg-drop-intentional')
    ) {
      continue
    }
    const params = paramStr!
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)
    const fwd = fwdStr!
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)
    if (params.length > fwd.length) {
      violations.push({
        file,
        line: i + 1,
        name: name!,
        reason: `declares ${params.length} params, forwards ${fwd.length}`,
      })
    }
  }
}

if (violations.length > 0) {
  console.error(`✗ deps-arity: ${violations.length} arg-drop forwarder(s):`)
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} ${v.name} — ${v.reason}`)
  }
  console.error(
    '\nFix: forward all args via `...rest` OR add `// arg-drop-intentional: <reason>` above the line.',
  )
  process.exit(1)
}

console.log('deps-arity: no arg-drop forwarders detected')
