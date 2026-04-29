import { describe, expect, mock, test } from 'bun:test'

// Mock host bindings BEFORE importing PermissionUpdate.
// PermissionUpdate → filesystem → getPermissionHostBindings throws if
// not installed. We provide a stub that lets toPosixPath (via getPlatform)
// fall through to its process.platform-based default.
const realHost = await import('../host.js')
mock.module('../host.js', () => ({
  ...realHost,
  getPermissionHostBindings: () => ({}),
}))

const { createReadRuleSuggestion, extractRules, hasRules } = await import(
  '../PermissionUpdate.js'
)
import type { PermissionUpdate } from '../PermissionUpdateSchema.js'

describe('extractRules — flatMap over addRules', () => {
  test('undefined input → empty array', () => {
    expect(extractRules(undefined)).toEqual([])
  })

  test('empty array → empty array', () => {
    expect(extractRules([])).toEqual([])
  })

  test('single addRules update — rules extracted', () => {
    const update: PermissionUpdate = {
      type: 'addRules',
      rules: [
        { toolName: 'Bash', ruleContent: 'ls' },
        { toolName: 'Read', ruleContent: '/path/**' },
      ],
      behavior: 'allow',
      destination: 'session',
    }
    expect(extractRules([update])).toEqual([
      { toolName: 'Bash', ruleContent: 'ls' },
      { toolName: 'Read', ruleContent: '/path/**' },
    ])
  })

  test('multiple addRules updates — flatMapped together', () => {
    const updates: PermissionUpdate[] = [
      {
        type: 'addRules',
        rules: [{ toolName: 'A', ruleContent: 'x' }],
        behavior: 'allow',
        destination: 'session',
      },
      {
        type: 'addRules',
        rules: [{ toolName: 'B', ruleContent: 'y' }],
        behavior: 'deny',
        destination: 'session',
      },
    ]
    expect(extractRules(updates)).toEqual([
      { toolName: 'A', ruleContent: 'x' },
      { toolName: 'B', ruleContent: 'y' },
    ])
  })

  test('non-addRules updates filtered out', () => {
    // setMode update has no rules — must be skipped via the default case.
    const updates: PermissionUpdate[] = [
      { type: 'setMode', mode: 'plan' } as PermissionUpdate,
      {
        type: 'addRules',
        rules: [{ toolName: 'X', ruleContent: 'r' }],
        behavior: 'allow',
        destination: 'session',
      },
    ]
    expect(extractRules(updates)).toEqual([{ toolName: 'X', ruleContent: 'r' }])
  })

  test('addRules with empty rules array → empty result for that update', () => {
    const update: PermissionUpdate = {
      type: 'addRules',
      rules: [],
      behavior: 'allow',
      destination: 'session',
    }
    expect(extractRules([update])).toEqual([])
  })

  test('return value is fresh array (caller can mutate without poisoning input)', () => {
    const updates: PermissionUpdate[] = [
      {
        type: 'addRules',
        rules: [{ toolName: 'X', ruleContent: 'r' }],
        behavior: 'allow',
        destination: 'session',
      },
    ]
    const r1 = extractRules(updates)
    const r2 = extractRules(updates)
    expect(r1).not.toBe(r2)
  })
})

describe('hasRules — predicate', () => {
  test('undefined → false', () => {
    expect(hasRules(undefined)).toBe(false)
  })

  test('empty array → false', () => {
    expect(hasRules([])).toBe(false)
  })

  test('only setMode updates → false (no rules)', () => {
    expect(
      hasRules([{ type: 'setMode', mode: 'plan' } as PermissionUpdate]),
    ).toBe(false)
  })

  test('addRules with at least one rule → true', () => {
    expect(
      hasRules([
        {
          type: 'addRules',
          rules: [{ toolName: 'X', ruleContent: 'r' }],
          behavior: 'allow',
          destination: 'session',
        },
      ]),
    ).toBe(true)
  })

  test('addRules with empty rules array → false', () => {
    // Critical: an addRules update with no rules is technically an
    // addRules type, but it adds no rules. hasRules should NOT count it
    // as having rules — the contract is "is there at least one rule".
    expect(
      hasRules([
        {
          type: 'addRules',
          rules: [],
          behavior: 'allow',
          destination: 'session',
        },
      ]),
    ).toBe(false)
  })

  test('mixed updates — true if any addRules has rules', () => {
    expect(
      hasRules([
        { type: 'setMode', mode: 'plan' } as PermissionUpdate,
        {
          type: 'addRules',
          rules: [{ toolName: 'X', ruleContent: 'r' }],
          behavior: 'allow',
          destination: 'session',
        },
      ]),
    ).toBe(true)
  })
})

describe('createReadRuleSuggestion — Read rule generation', () => {
  test('absolute path → wrapped with leading "/" and trailing "/**"', () => {
    expect(createReadRuleSuggestion('/Users/me/project')).toEqual({
      type: 'addRules',
      rules: [{ toolName: 'Read', ruleContent: '//Users/me/project/**' }],
      behavior: 'allow',
      destination: 'session',
    })
  })

  test('relative path → no leading slash, just trailing /**', () => {
    expect(createReadRuleSuggestion('relative/dir')).toEqual({
      type: 'addRules',
      rules: [{ toolName: 'Read', ruleContent: 'relative/dir/**' }],
      behavior: 'allow',
      destination: 'session',
    })
  })

  test('root "/" → undefined (cannot grant universal Read)', () => {
    // CRITICAL: a Read rule for "/" would allow reading everything
    // anywhere on the filesystem. The function returns undefined to
    // refuse this dangerous request.
    expect(createReadRuleSuggestion('/')).toBeUndefined()
  })

  test('Windows-shaped path on non-Windows platform — backslashes preserved', () => {
    // toPosixPath only converts \ to / on `windows` platform. On macOS
    // (test machine), backslashes pass through. Documents the platform
    // dependency — test result reflects the test runner's host.
    const result = createReadRuleSuggestion('C:\\Users\\me')
    // posix.isAbsolute('C:\\Users\\me') is false → no leading slash added.
    expect(result?.rules[0]?.ruleContent).toBe('C:\\Users\\me/**')
  })

  test('default destination is "session" if not provided', () => {
    expect(createReadRuleSuggestion('/some/path')?.destination).toBe(
      'session',
    )
  })

  test('custom destination overrides default', () => {
    expect(
      createReadRuleSuggestion('/some/path', 'localSettings')?.destination,
    ).toBe('localSettings')
  })

  test('preserves trailing slashes if present', () => {
    // Documents that the function does NOT normalize trailing slashes.
    // Caller is responsible for already-clean path input.
    const result = createReadRuleSuggestion('/some/path/')
    // toPosixPath leaves the trailing slash. Then the absolute check
    // sees /some/path/ as absolute → wrapped as //some/path//**
    expect(result?.rules[0]?.ruleContent).toBe('//some/path//**')
  })

  test('rule structure — addRules type, behavior allow, toolName Read', () => {
    // Anchor the structure so refactors that change e.g. behavior to
    // 'ask' (which would surface a permission prompt) get caught.
    const result = createReadRuleSuggestion('/x/y')
    expect(result?.type).toBe('addRules')
    expect(result?.behavior).toBe('allow')
    expect(result?.rules[0]?.toolName).toBe('Read')
    expect(result?.rules.length).toBe(1)
  })
})
