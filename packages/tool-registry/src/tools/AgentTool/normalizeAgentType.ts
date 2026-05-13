/**
 * Normalize a subagent_type string for fuzzy lookup.
 *
 * Port of ant v2.1.140 II7 (3750.js:37):
 *   H.normalize("NFKC").toLowerCase().replace(/[\p{White_Space}\p{Pd}_]+/gu, "")
 *
 * Lets callers pass "Code Reviewer" or "code_reviewer" or "Code-Reviewer"
 * and have it resolve to the canonical `code-reviewer` agent definition.
 *
 * The strip-set:
 *   \p{White_Space}  — all Unicode whitespace
 *   \p{Pd}           — Unicode dash punctuation (hyphen, en-dash, em-dash, etc.)
 *   _                — underscore (not covered by \p{Pd})
 *
 * NFKC unifies compatibility forms (e.g. full-width ASCII).
 */
export function normalizeAgentType(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/[\p{White_Space}\p{Pd}_]+/gu, '')
}
