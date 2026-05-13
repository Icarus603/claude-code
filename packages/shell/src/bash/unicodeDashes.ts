/**
 * Unicode-dash → ASCII hyphen normaliser.
 *
 * Ported from ant v2.1.136 `Le()` (module 3999). Closes a class of permission
 * bypasses where the model emits an en-dash / em-dash / horizontal-bar
 * (U+2013, U+2014, U+2015) in flag names — `rm —rf` looks identical to
 * `rm --rf` in a terminal but the permission classifier sees a different
 * argv. Real shells DO NOT treat these as hyphens (they are just literal
 * characters), so once they get past the classifier the command would
 * either no-op or fail. The bypass risk is the classifier mis-classifying,
 * not the shell mis-executing. By normalising every text/name/argv field
 * BEFORE it reaches the classifier, we guarantee the classifier and the
 * shell agree on what the command is.
 *
 * Apply in:
 * - SimpleCommand.text / .argv[] (ast.ts, ast-alias.ts)
 * - extractRules / permission rule parser inputs
 * - any classifier-facing string extracted from raw command text
 *
 * Do NOT apply to the command string that ACTUALLY runs in the shell —
 * the user may have typed an em-dash deliberately (e.g. in an echoed
 * comment) and we should preserve it for stdout fidelity.
 */
const UNICODE_DASH_RE = /[\u2013\u2014\u2015]/g

export function sanitizeUnicodeDashes(text: string): string {
  return text.replace(UNICODE_DASH_RE, '-')
}

/**
 * Convenience for argv arrays. Returns a new array.
 */
export function sanitizeUnicodeDashesArgv(argv: readonly string[]): string[] {
  return argv.map(sanitizeUnicodeDashes)
}
