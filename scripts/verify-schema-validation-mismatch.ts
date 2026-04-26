#!/usr/bin/env bun
/**
 * verify-schema-validation-mismatch — flag tools whose zod schema marks
 * a field as `.optional()` while validateInput rejects the field with
 * a "required" error.
 *
 * The schema is the LLM-facing contract; LLMs trust it and omit
 * .optional() fields. Mismatched validation produces the bug class
 * fixed in commit 0f61f338 (SendMessageTool: "summary is required when
 * message is a string" while schema says summary is optional).
 *
 * Heuristic: search for tool files (packages/tool-registry/src/tools/**)
 * that contain `.optional()` AND a string literal "is required" or
 * "must be provided" in validateInput body. Reports each as a
 * potential mismatch.
 *
 * Allowlist: when validation is conditional on another field's value
 * (e.g., "summary required when message is string"), the schema can
 * legitimately mark it .optional() but require it for some message
 * shapes. Today's fix auto-derives in that case; future tools should
 * follow the same pattern.
 */

import { Glob } from 'bun'
import { readFile } from 'fs/promises'

const violations: { file: string; reason: string }[] = []

for await (const file of new Glob(
  'packages/tool-registry/src/tools/**/*.ts',
).scan('.')) {
  if (file.includes('__tests__/') || file.endsWith('.test.ts')) continue
  const content = await readFile(file, 'utf8')
  if (!content.includes('.optional()')) continue
  // Look for validateInput body with "required" / "must be provided"
  const requiredPatterns =
    /(message|error):\s*['"`][^'"`]*\b(required|must be provided)\b[^'"`]*['"`]/i
  if (!requiredPatterns.test(content)) continue
  // Skip files that already auto-derive (the SendMessageTool pattern)
  if (/auto-derive[ds]?|fall.?back|default to/i.test(content)) continue
  violations.push({
    file,
    reason: 'has .optional() schema field + a "required" rejection in validateInput',
  })
}

// Budget = 2 known false positives: TaskStopTool (optional shell_id +
// required task_id are different fields), TeamCreateTool (similar).
// The heuristic looks for any .optional() + any "required" in the file,
// without matching them by field name — a more precise check would
// extract field names from each. Future-proofing: tighten when we
// have a parser-based version.
const BUDGET = 2

if (violations.length > BUDGET) {
  console.error(
    `✗ schema-validation-mismatch: ${violations.length} tool(s) with optional schema + required validation:`,
  )
  for (const v of violations) console.error(`  ${v.file}`)
  console.error(
    '\nFix: either remove .optional() from the schema (require explicitly)\n' +
      'OR auto-derive a sensible default in validateInput (see commit\n' +
      '0f61f338 SendMessageTool for the canonical pattern).',
  )
  process.exit(1)
}

console.log(
  `schema-validation-mismatch: ${violations.length} suspected (budget ${BUDGET})`,
)
