/**
 * Tests for getValidationTip — pure helper that maps a Zod validation
 * issue (path + code + expected/received) to a user-facing suggestion
 * + documentation link.
 *
 * Wrong matcher = users see generic "invalid_type" / "unrecognized_keys"
 * instead of actionable hints. The path-prefix doc-link fallback is
 * particularly easy to break (any new section needs an entry).
 *
 * The PATH_DOC_LINKS fallback is "if no matcher matches but the path
 * starts with a known section prefix, attach a section-level doc link".
 */
import { describe, expect, test } from 'bun:test'
import { getValidationTip } from '../settings/validationTips.js'

describe('getValidationTip — specific matchers', () => {
  test('permissions.defaultMode invalid_value → mode list suggestion', () => {
    const r = getValidationTip({
      path: 'permissions.defaultMode',
      code: 'invalid_value',
    })
    expect(r?.suggestion).toContain('acceptEdits')
    expect(r?.suggestion).toContain('plan')
    expect(r?.suggestion).toContain('bypassPermissions')
    expect(r?.docLink).toContain('iam#permission-modes')
  })

  test('apiKeyHelper invalid_type → command suggestion', () => {
    const r = getValidationTip({
      path: 'apiKeyHelper',
      code: 'invalid_type',
    })
    expect(r?.suggestion).toContain('shell command')
  })

  test('cleanupPeriodDays too_small with expected=0 → guidance', () => {
    const r = getValidationTip({
      path: 'cleanupPeriodDays',
      code: 'too_small',
      expected: '0',
    })
    expect(r?.suggestion).toContain('0 or greater')
  })

  test('cleanupPeriodDays too_small with DIFFERENT expected → no specific match', () => {
    const r = getValidationTip({
      path: 'cleanupPeriodDays',
      code: 'too_small',
      expected: '5',
    })
    // No matcher matches → falls through to path-prefix lookup, but
    // 'cleanupPeriodDays' is not in PATH_DOC_LINKS prefixes.
    expect(r).toBeNull()
  })
})

describe('getValidationTip — env.* prefix matchers', () => {
  test('env.DEBUG invalid_type → string-coercion hint + docLink', () => {
    const r = getValidationTip({
      path: 'env.DEBUG',
      code: 'invalid_type',
    })
    expect(r?.suggestion).toContain('strings')
    expect(r?.suggestion).toContain('quotes')
    expect(r?.docLink).toContain('settings#environment-variables')
  })

  test('env.PORT invalid_type matched by startsWith("env.")', () => {
    const r = getValidationTip({
      path: 'env.PORT',
      code: 'invalid_type',
    })
    expect(r).not.toBeNull()
  })

  test('"env" alone (no dot) does NOT match env.* matcher → null', () => {
    // Documented contract: matcher uses path.startsWith('env.') with a
    // trailing dot. 'env' alone doesn't match → no matcher hit → null.
    // PATH_DOC_LINKS fallback only injects a docLink ONTO a matched tip,
    // so no auto-stub is created here.
    const r = getValidationTip({
      path: 'env',
      code: 'invalid_type',
    })
    expect(r).toBeNull()
  })
})

describe('getValidationTip — permissions.allow / .deny array tips', () => {
  test('permissions.allow invalid_type expected=array → array example', () => {
    const r = getValidationTip({
      path: 'permissions.allow',
      code: 'invalid_type',
      expected: 'array',
    })
    expect(r?.suggestion).toContain('array')
    expect(r?.suggestion).toContain('Bash(npm run build)')
  })

  test('permissions.deny invalid_type expected=array → same array example', () => {
    const r = getValidationTip({
      path: 'permissions.deny',
      code: 'invalid_type',
      expected: 'array',
    })
    expect(r?.suggestion).toContain('array')
  })

  test('permissions.allow invalid_type but expected != array → no matcher matches → null', () => {
    // Documented contract: PATH_DOC_LINKS fallback only applies INSIDE a
    // matched matcher's tip — when no matcher matches, getValidationTip
    // returns null, not a stub-with-docLink.
    const r = getValidationTip({
      path: 'permissions.allow',
      code: 'invalid_type',
      expected: 'string',
    })
    expect(r).toBeNull()
  })
})

describe('getValidationTip — hooks tips', () => {
  test('hooks invalid_type → matcher format documented', () => {
    const r = getValidationTip({
      path: 'hooks',
      code: 'invalid_type',
    })
    expect(r?.suggestion).toContain('matcher')
    expect(r?.suggestion).toContain('Edit|Write')
  })

  test('PostToolUse.X.hooks (deeply nested with "hooks" in path) matches', () => {
    // Documented: matcher uses path.includes('hooks'), so nested paths
    // with 'hooks' anywhere also trigger.
    const r = getValidationTip({
      path: 'PostToolUse.0.hooks',
      code: 'invalid_type',
    })
    expect(r?.suggestion).toContain('matcher')
  })
})

describe('getValidationTip — boolean type hint', () => {
  test('any path with invalid_type expected=boolean → bool guidance', () => {
    const r = getValidationTip({
      path: 'includeCoAuthoredBy',
      code: 'invalid_type',
      expected: 'boolean',
    })
    expect(r?.suggestion).toContain('true or false')
  })

  test('boolean tip is unanchored to path → works for any field', () => {
    const r = getValidationTip({
      path: 'someRandomField',
      code: 'invalid_type',
      expected: 'boolean',
    })
    expect(r?.suggestion).toContain('true or false')
  })
})

describe('getValidationTip — unrecognized_keys', () => {
  test('any path with unrecognized_keys → typo guidance + settings doc', () => {
    const r = getValidationTip({
      path: 'someField',
      code: 'unrecognized_keys',
    })
    expect(r?.suggestion).toContain('typos')
    expect(r?.docLink).toContain('settings')
  })
})

describe('getValidationTip — invalid_value with enumValues', () => {
  test('invalid_value + enumValues → "Valid values: ..." synthesis', () => {
    // No path-specific matcher, so falls through to the synthetic enum tip.
    const r = getValidationTip({
      path: 'unknownField',
      code: 'invalid_value',
      enumValues: ['a', 'b', 'c'],
    })
    expect(r?.suggestion).toContain('Valid values')
    expect(r?.suggestion).toContain('"a"')
    expect(r?.suggestion).toContain('"b"')
  })

  test('enumValues fallback fires only when no specific suggestion exists', () => {
    // permissions.defaultMode + invalid_value has its OWN suggestion, so
    // enumValues should NOT replace it.
    const r = getValidationTip({
      path: 'permissions.defaultMode',
      code: 'invalid_value',
      enumValues: ['x', 'y'],
    })
    expect(r?.suggestion).toContain('acceptEdits')
    expect(r?.suggestion).not.toContain('Valid values')
  })
})

describe('getValidationTip — JSON syntax (root invalid_type expected=object)', () => {
  test('root path with received=null + expected=object → JSON syntax tip', () => {
    const r = getValidationTip({
      path: '',
      code: 'invalid_type',
      expected: 'object',
      received: null,
    })
    expect(r?.suggestion).toContain('commas')
    expect(r?.suggestion).toContain('brackets')
  })

  test('root with non-null received does NOT match JSON syntax matcher', () => {
    const r = getValidationTip({
      path: '',
      code: 'invalid_type',
      expected: 'object',
      received: 'string',
    })
    // No specific matcher matches; root path has no prefix for PATH_DOC_LINKS.
    expect(r).toBeNull()
  })
})

describe('getValidationTip — additionalDirectories', () => {
  test('permissions.additionalDirectories invalid_type → array hint', () => {
    const r = getValidationTip({
      path: 'permissions.additionalDirectories',
      code: 'invalid_type',
    })
    expect(r?.suggestion).toContain('array of directory paths')
    expect(r?.docLink).toContain('iam#working-directories')
  })
})

describe('getValidationTip — no-matcher cases return null', () => {
  test('unmatched path with "permissions" prefix → null (PATH_DOC_LINKS only injects on matched tips)', () => {
    // Important locked behaviour: PATH_DOC_LINKS is NOT a fallback —
    // it only adds a docLink WHEN a matcher already matched but didn't
    // include one. With no matcher match, the function returns null.
    const r = getValidationTip({
      path: 'permissions.someUnknownField',
      code: 'too_big',
    })
    expect(r).toBeNull()
  })

  test('unmatched path with "hooks" prefix → null', () => {
    const r = getValidationTip({
      path: 'hooks.0',
      code: 'too_big',
    })
    expect(r).toBeNull()
  })

  test('unmatched path WITHOUT known prefix → null', () => {
    const r = getValidationTip({
      path: 'completelyUnknownPath',
      code: 'too_big',
    })
    expect(r).toBeNull()
  })

  test('empty path with no matching code → null', () => {
    const r = getValidationTip({
      path: '',
      code: 'too_big',
    })
    expect(r).toBeNull()
  })
})

describe('getValidationTip — PATH_DOC_LINKS fallback (only on matched tip without docLink)', () => {
  test('unrecognized_keys matcher has no docLink: PATH_DOC_LINKS fills it from path prefix', () => {
    // Wait — unrecognized_keys has docLink: settings/. So path prefix
    // matters. Use boolean-type which has no docLink in matcher.
    const r = getValidationTip({
      path: 'permissions.allowSomething',
      code: 'invalid_type',
      expected: 'boolean',
    })
    // boolean matcher fires (no path constraint), docLink absent in
    // matcher.tip → PATH_DOC_LINKS for 'permissions' attaches the link.
    expect(r?.suggestion).toContain('true or false')
    expect(r?.docLink).toContain('iam#configuring-permissions')
  })

  test('boolean matcher with non-prefix path: no docLink attached', () => {
    const r = getValidationTip({
      path: 'someRandomField',
      code: 'invalid_type',
      expected: 'boolean',
    })
    expect(r?.suggestion).toContain('true or false')
    expect(r?.docLink).toBeUndefined()
  })
})

describe('getValidationTip — return shape', () => {
  test('matched tip returns object', () => {
    const r = getValidationTip({
      path: 'apiKeyHelper',
      code: 'invalid_type',
    })
    expect(typeof r).toBe('object')
  })

  test('returned object has suggestion and/or docLink', () => {
    const r = getValidationTip({
      path: 'permissions.defaultMode',
      code: 'invalid_value',
    })
    expect('suggestion' in (r ?? {})).toBe(true)
    expect('docLink' in (r ?? {})).toBe(true)
  })

  test('docLink uses production base URL', () => {
    const r = getValidationTip({
      path: 'permissions.defaultMode',
      code: 'invalid_value',
    })
    expect(r?.docLink).toContain('code.claude.com/docs/en')
  })
})
