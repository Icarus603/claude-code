import { describe, expect, test } from 'bun:test'

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Source-level pin for prefetchApiKeyFromApiKeyHelperIfSafe vs ant rt6 (1997.js):
 *
 *   function rt6(H) {
 *     if(KA9() && !h3()) return;     // project/local apiKeyHelper requires trust
 *     VxH(H)                          // getApiKeyFromApiKeyHelper (fire and forget)
 *   }
 *
 * The trust gate is a SECURITY boundary — workspace-scoped apiKeyHelper can
 * execute arbitrary shell commands. We must not run it during boot (before
 * the user sees and accepts the workspace-trust dialog), even just for cache
 * warming.
 */
describe('prefetchApiKeyFromApiKeyHelperIfSafe (ant rt6 parity)', () => {
  const authAliasSource = readFileSync(
    resolve(__dirname, '..', 'authAlias.ts'),
    'utf-8',
  )

  const fnStart = authAliasSource.indexOf(
    'export function prefetchApiKeyFromApiKeyHelperIfSafe',
  )
  const fnSlice = authAliasSource.slice(fnStart, fnStart + 600)

  test('trust gate: project/local apiKeyHelper + no trust ⇒ return without execution', () => {
    expect(fnSlice).toMatch(
      /if\s*\(\s*\n?\s*isApiKeyHelperFromProjectOrLocalSettings\(\)\s*&&\s*\n?\s*!checkHasTrustDialogAccepted\(\)\s*\n?\s*\)\s*\{?\s*\n?\s*return/,
    )
  })

  test('execution after gate is fire-and-forget (void) — does NOT await', () => {
    // ant: `VxH(H)` is invoked without await — the cache warms in the
    // background. If we awaited, the prefetch would block startup.
    expect(fnSlice).toMatch(
      /void\s+getApiKeyFromApiKeyHelper\(isNonInteractiveSession\)/,
    )
  })

  test('accepts isNonInteractiveSession boolean (used for trust-error escalation)', () => {
    expect(fnSlice).toMatch(
      /prefetchApiKeyFromApiKeyHelperIfSafe\(\s*\n?\s*isNonInteractiveSession:\s*boolean,?\s*\n?\s*\):\s*void/,
    )
  })

  test('inner _executeApiKeyHelper has the SAME trust gate (defense-in-depth)', () => {
    // ant has the same trust check in MX1 (executeApiKeyHelper). Pre-trust
    // we'd return null and emit `tengu_apiKeyHelper_missing_trust` — pin
    // this duplication is intentional so a future caller of the inner
    // helper still gets the check.
    expect(authAliasSource).toMatch(
      /if\s*\(isApiKeyHelperFromProjectOrLocalSettings\(\)\)\s*\{[\s\S]*?if\s*\(!hasTrust/,
    )
    expect(authAliasSource).toMatch(/tengu_apiKeyHelper_missing_trust/)
  })
})
